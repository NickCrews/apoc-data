"""Scrape the Alaska Public Offices Commission website for campaign finance data.

Uses Playwright to emulate me going to the page and clicking the buttons.
The site appears to be built with ASP.NET, so it's not easy to scrape
using requests and BeautifulSoup. All the state is stored in the session,
so you can't just make a GET request to the export URL.
You need to actually have a browser session that has gone through the
proper steps to get the data.
"""

from __future__ import annotations

import asyncio
import logging
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, AsyncIterable, ClassVar, Coroutine, Iterable, Protocol

from playwright.async_api import BrowserContext, async_playwright, expect

from ._filters import ScrapeFilters, YearEnum

if TYPE_CHECKING:
    from playwright.async_api import BrowserContext, Download, Page

_logger = logging.getLogger(__name__)

DEFAULT_DIRECTORY = "scraped/"


@asynccontextmanager
async def make_browser_async(headless: bool = True) -> AsyncIterable[BrowserContext]:
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=headless,
            # This sometimes avoids race conditions?
            # slow_mo=200,
        )
        yield await browser.new_context(
            **p.devices["Desktop Chrome"],
        )


async def _run_scrape_flow(page: Page, url: str, filters: ScrapeFilters) -> Download:
    # unconditionally reload the page to clear out any old state
    await page.goto(url)

    # after page load it takes a bit for the dropdowns to be ready?
    await page.wait_for_timeout(100)
    await page.select_option("select:below(:text('Status:'))", filters.status.value)
    await page.select_option(
        "select:below(:text('Report Year:'))", filters.report_year.value
    )
    # it still appears a manual wait is needed??
    await page.wait_for_timeout(100)

    await page.click("//input[@value='Search']")
    await page.wait_for_timeout(100)
    # Wait for either 1. results to come in or 2. the "no results" message to show.
    # Otherwise if we export too early we won't get any data.
    # On some of the search UIs, it can take several seconds for the data to load,
    # so set a long timeout.
    await expect(page.get_by_text("Press 'Search' to Load Results.")).to_be_hidden(
        timeout=30_000
    )

    await page.click("//input[@value='Export']")
    # This has to wait for the server to actually begin the download.
    # When it is really busy, this can take a long time.
    # So we make this timeout quite large.
    async with page.expect_download(timeout=120_000) as download_info:
        # The first link with text ".CSV" below the text "Export All Pages:"
        await page.click("a:text('.CSV'):below(:text('Export All Pages:'))")

    await page.click("//input[@value='Close']")
    return await download_info.value


class PScraper(Protocol):
    def __call__(self, browser_context: BrowserContext) -> None:
        """Given a browser context, scrape the data.

        The destination path, the chosen filters, etc all should be known
        as context, eg as instance variables.
        """


async def run_scrapers(
    scrapers: Iterable[PScraper],
    *,
    browser_context: BrowserContext
    | Coroutine[None, None, BrowserContext]
    | None = None,
) -> None:
    if isinstance(browser_context, BrowserContext):
        for s in scrapers:
            await s(browser_context)
    elif isinstance(browser_context, Coroutine):
        browser_context = await browser_context
        await run_scrapers(scrapers, browser_context=browser_context)
    elif browser_context is None:
        async with make_browser_async() as ctx:
            await run_scrapers(scrapers, browser_context=ctx)


class _ScraperBase:
    _HOME_URL: ClassVar[str]
    """The URL to start the scrape from."""
    _HEADER_ROW: ClassVar[str]
    """The header row for the CSV file. If a download is empty, this will instead be written so that the CSV is still valid."""
    name: ClassVar[str]

    def __init__(
        self,
        *,
        destination: str | Path,
        filters: ScrapeFilters | None = None,
    ):
        self.destination = Path(destination)
        self.filters = filters or ScrapeFilters()

    async def __call__(self, browser_context: BrowserContext) -> None:
        page = (
            browser_context.pages[0]
            if browser_context.pages
            else await browser_context.new_page()
        )
        _logger.info(
            f"Downloading {self.name} to {self.destination} using {self.filters}"
        )
        download = await _run_scrape_flow(page, self._HOME_URL, self.filters)
        _logger.info("Download started")
        path = await download.path()
        if path.stat().st_size == 0:
            # We end up with an empty file, instead of a CSV with a header row and
            # no data rows. In downstream processing this makes importing data
            # with *.csv barf.
            _logger.info(f"No results. Writing header to {self.destination}")
            self.destination.parent.mkdir(parents=True, exist_ok=True)
            content = self._HEADER_ROW
            if not content.endswith("\n"):
                content += "\n"
            self.destination.write_text(content)
        else:
            check_valid_csv(path)
            await download.save_as(self.destination)
            _logger.info(f"Downloaded {self.destination}")

    def run(
        self,
        browser_context: BrowserContext
        | Coroutine[None, None, BrowserContext]
        | None = None,
    ) -> None:
        """Run the download in the given browser"""
        asyncio.run(run_scrapers([self], browser_context=browser_context))


def check_valid_csv(path: Path) -> None:
    """Sometimes APOC gives a runtime error if you try to export too many rows."""
    with open(path) as f:
        for i, line in enumerate(f):
            if "<html>" in line:
                raise ValueError(f"Bad CSV content in line {i} of {path}: {line}")


class CandidateRegistrationScraper(_ScraperBase):
    _HOME_URL = "https://aws.state.ak.us/ApocReports/Registration/CandidateRegistration/CRForms.aspx"
    _HEADER_ROW = '''"Result","Report Year","Display Name","Last Name","First Name","Committee","Purpose","Previously Registered","Address","City","State","Zip","Country","Phone","Fax","Email","Election","Election Type","Municipality","Office","Treasurer Name","Treasurer Email","Treasurer Phone","Chair Name","Chair Email","Chair Phone","Bank Name","Bank Address","Bank City","Bank State","Bank Zip","Bank Country","Submitted","Status","Amending"'''
    name = "candidate_registration"


class LetterOfIntentScraper(_ScraperBase):
    _HOME_URL = (
        "https://aws.state.ak.us/ApocReports/Registration/LetterOfIntent/LOIForms.aspx"
    )
    _HEADER_ROW = '''"Result","Report Year","Display Name","Last Name","First Name","Previously Registered","Phone","Fax","Email","Election","Election Type","Municipality","Office","Submitted","Status","Amending"'''
    name = "letter_of_intent"


class GroupRegistrationScraper(_ScraperBase):
    _HOME_URL = "https://aws.state.ak.us/ApocReports/Registration/GroupRegistration/GRForms.aspx"
    _HEADER_ROW = '''"Result","Report Year","Abbreviation","Name","Address","City","State","Zip","Country","Plan","Type","Subtype","Treasurer Name","Treasurer Email","Chair Name","Chair Email","Additional Emails","Submitted","Status","Amending"'''
    name = "group_registration"


class EntityRegistrationScraper(_ScraperBase):
    _HOME_URL = "https://aws.state.ak.us/ApocReports/Registration/EntityRegistration/ERForms.aspx"
    _HEADER_ROW = '''"Result","Report Year","Abbreviation","Name","Purpose","Supporting State Initiative","Phone","Email","Address","City","State","Zip","Country","Contact Name","Contact Email","Submitted","Status","Amending"'''
    name = "entity_registration"


class DebtScraper(_ScraperBase):
    _HOME_URL = "https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDDebt.aspx"
    _HEADER_ROW = '''"Result","Date","Balance Remaining","Original Amount","Name","Address","City","State","Zip","Country","Description/Purpose","--------","Filer Type","Name","Report Year","Submitted"'''
    name = "debt"


class ExpenditureScraper(_ScraperBase):
    _HOME_URL = (
        "https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDExpenditures.aspx"
    )
    _HEADER_ROW = '''"Result","Date","Transaction Type","Payment Type","Payment Detail","Amount","Last/Business Name","First Name","Address","City","State","Zip","Country","Occupation","Employer","Purpose of Expenditure","--------","Report Type","Election Name","Election Type","Municipality","Office","Filer Type","Name","Report Year","Submitted"'''
    name = "expenditures"


class _AnyYearMicroBatchScraper(_ScraperBase):
    """A scraper that downloads report_year=Any in micro-batches.

    For some form types, if you try to download all years at once, the APOC
    server crashes, and you get a "500 Internal Server Error" jammed into
    the end of a truncated CSV file. This scraper works around that by
    downloading each year in a separate batch, and then merging the CSVs.

    I sent Robert Buchanon from APOC an email about this, he fixed a similar bug for
    me last year. Hopefully soon this will be fixed and we don't need this workaround.
    """

    def __init__(
        self,
        *,
        destination: str | Path,
        filters: ScrapeFilters | None = None,
        tempdir: Path | None = None,
    ):
        super().__init__(filters=filters, destination=destination)
        self.tempdir = tempdir

    async def __call__(self, browser_context: BrowserContext) -> None:
        if self.filters.report_year != YearEnum.any:
            return await super().__call__(browser_context)

        async def f(tmpdir):
            tmpdir = Path(tmpdir)
            sub_scrapers = [
                self.__class__(
                    filters=ScrapeFilters(report_year=year, status=self.filters.status),
                    destination=tmpdir / f"{self.name}_{year.value}.csv",
                )
                for year in YearEnum
                if year != YearEnum.any
            ]
            for s in sub_scrapers:
                await s(browser_context)
            _merge_csvs([s.destination for s in sub_scrapers], self.destination)

        if self.tempdir is None:
            with tempfile.TemporaryDirectory() as tmpdir:
                await f(tmpdir)
        else:
            await f(self.tempdir)


def _merge_csvs(srcs: Iterable[Path], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with open(destination, "wb") as f:
        header_written = False
        i = 1
        for s in srcs:
            with open(s, "rb") as subf:
                first_line = subf.readline()
                if not header_written:
                    if not first_line.endswith(b"\n"):
                        first_line += b"\n"
                    f.write(first_line)
                    header_written = True
                for line in subf:
                    old_result, rest = line.split(b",", 1)
                    fixed_result = f"{i},".encode()
                    f.write(fixed_result + rest)
                    i += 1


class IncomeScraper(_AnyYearMicroBatchScraper):
    _HOME_URL = "https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDIncome.aspx"
    _HEADER_ROW = '''"Result","Date","Transaction Type","Payment Type","Payment Detail","Amount","Last/Business Name","First Name","Address","City","State","Zip","Country","Occupation","Employer","Purpose of Expenditure","--------","Report Type","Election Name","Election Type","Municipality","Office","Filer Type","Name","Report Year","Submitted"'''
    name = "income"


class CampaignFormScraper(_AnyYearMicroBatchScraper):
    _HOME_URL = "https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDForms.aspx"
    _HEADER_ROW = '''"Result","Report Year","Report Type","Begin Date","End Date","Filer Type","Name","Beginning Cash On Hand","Total Income","Previous Campaign Income","Campaign Income Total","Total Expenditures","Previous Campaign Expense","Campaign Expense Total","Closing Cash On Hand","Total Debt","Surplus/Deficit","Submitted","Status","Amending"'''
    name = "campaign_form"


def scrape_all(
    directory: str | Path = DEFAULT_DIRECTORY,
    *,
    headless: bool = True,
) -> None:
    """Scrape .CSVs from https://aws.state.ak.us/ApocReports/Campaign/

    This will download the following files:
    - candidate_registration.csv
    - letter_of_intent.csv
    - group_registration.csv
    - entity_registration.csv
    - campaign_form.csv
    - income.csv
    - expenditure.csv
    - debt.csv

    Parameters
    ----------
    directory : str or Path
        The directory to save the files to.
    browser_context : BrowserContext, optional
        A browser context to use for downloading.
        If not provided, a temporary one will be created.
    """
    directory = Path(directory)
    classes: list[_ScraperBase] = [
        CampaignFormScraper,
        IncomeScraper,
        CandidateRegistrationScraper,
        LetterOfIntentScraper,
        GroupRegistrationScraper,
        EntityRegistrationScraper,
        DebtScraper,
        ExpenditureScraper,
    ]
    scrapers = [cls(destination=directory / f"{cls.name}.csv") for cls in classes]

    async def run():
        async with make_browser_async(headless=headless) as browser_context:
            await run_scrapers(scrapers, browser_context=browser_context)

    asyncio.run(run())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    scrape_all()
