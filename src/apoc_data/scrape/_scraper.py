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
import csv
import logging
import random
import subprocess
import sys
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import (
    TYPE_CHECKING,
    Any,
    AsyncGenerator,
    Awaitable,
    Callable,
    ClassVar,
    Coroutine,
    Iterable,
    Protocol,
)

from playwright.async_api import BrowserContext, async_playwright, expect
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from ._filters import ScrapeFilters, YearEnum

if TYPE_CHECKING:
    from playwright.async_api import BrowserContext, Download, Page

_logger = logging.getLogger(__name__)

DEFAULT_DIRECTORY = "scraped/"

DEFAULT_ATTEMPTS = 4
"""How many times to try a single scrape before giving up.

The APOC server is intermittently slow, and a full run makes ~48 scrapes,
so without retries a single hiccup fails the whole run.
"""
DEFAULT_RETRY_BACKOFF = 5.0
"""Base number of seconds for exponential backoff between retries."""

_ACTION_TIMEOUT = 60_000
"""Default timeout for ordinary page actions (clicks, select_option, ...).

Playwright's own default is 30s, which we've seen the server blow past.
"""
_SEARCH_TIMEOUT = 180_000
"""How long to wait for search results to replace the "Press 'Search'" message."""
_DOWNLOAD_TIMEOUT = 300_000
"""How long to wait for the server to *begin* sending the export.

Successful runs have been observed taking ~90s, so the old 120s was cutting
it very close whenever the server was under load.
"""

_RETRYABLE = (
    # Any of the waits in _run_scrape_flow blowing their timeout.
    PlaywrightTimeoutError,
    # `expect(...).to_be_hidden()` raises AssertionError, not TimeoutError.
    AssertionError,
    # check_valid_csv: APOC jams a 500 error into the CSV when it's overloaded.
    ValueError,
)
"""Exceptions that indicate a flaky server rather than a broken scraper."""


async def _retrying(
    make_coro: Callable[[], Awaitable[Any]],
    *,
    what: str,
    attempts: int = DEFAULT_ATTEMPTS,
    backoff: float = DEFAULT_RETRY_BACKOFF,
) -> Any:
    """Await `make_coro()`, retrying with exponential backoff + jitter.

    `make_coro` is a zero-arg callable (not a coroutine) because a coroutine
    can only be awaited once; we need a fresh one per attempt.
    """
    for attempt in range(1, attempts + 1):
        try:
            return await make_coro()
        except _RETRYABLE as e:
            if attempt == attempts:
                _logger.error(f"{what}: failed after {attempts} attempts")
                raise
            # Jitter so that a whole run doesn't retry in lockstep.
            delay = backoff * 2 ** (attempt - 1) + random.uniform(0, backoff)
            _logger.warning(
                f"{what}: attempt {attempt}/{attempts} failed "
                f"({type(e).__name__}: {str(e).splitlines()[0]}). "
                f"Retrying in {delay:.1f}s"
            )
            await asyncio.sleep(delay)


def _ensure_chromium_installed(executable_path: str) -> None:
    """Install the playwright chromium browser if it isn't already.

    This saves users from needing to run `playwright install chromium`
    manually before their first scrape.
    """
    if Path(executable_path).exists():
        return
    _logger.info("Chromium not found. Running 'playwright install chromium'...")
    subprocess.run(
        [sys.executable, "-m", "playwright", "install", "chromium"], check=True
    )


@asynccontextmanager
async def make_browser_async(headless: bool = True) -> AsyncGenerator[BrowserContext]:
    async with async_playwright() as p:
        _ensure_chromium_installed(p.chromium.executable_path)
        browser = await p.chromium.launch(
            headless=headless,
            # This sometimes avoids race conditions?
            # slow_mo=200,
        )
        yield await browser.new_context(
            **p.devices["Desktop Chrome"],
        )


async def _run_scrape_flow(page: Page, url: str, filters: ScrapeFilters) -> Download:
    # Each attempt gets a brand new page (see _scrape_once), so this is a
    # plain navigation rather than a reset of a dirty one.
    page.set_default_timeout(_ACTION_TIMEOUT)
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
        timeout=_SEARCH_TIMEOUT
    )

    await page.click("//input[@value='Export']")
    # This has to wait for the server to actually begin the download.
    # When it is really busy, this can take a long time.
    # So we make this timeout quite large.
    async with page.expect_download(timeout=_DOWNLOAD_TIMEOUT) as download_info:
        # The first link with text ".CSV" below the text "Export All Pages:"
        await page.click("a:text('.CSV'):below(:text('Export All Pages:'))")

    await page.click("//input[@value='Close']")
    return await download_info.value


class PScraper(Protocol):
    async def __call__(self, browser_context: BrowserContext) -> None:
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
        attempts: int = DEFAULT_ATTEMPTS,
        retry_backoff: float = DEFAULT_RETRY_BACKOFF,
    ):
        self.destination = Path(destination)
        self.filters = filters or ScrapeFilters()
        self.attempts = attempts
        self.retry_backoff = retry_backoff

    async def __call__(self, browser_context: BrowserContext) -> None:
        _logger.info(
            f"Downloading {self.name} to {self.destination} using {self.filters}"
        )
        # The APOC server is intermittently slow: any of the waits inside
        # _run_scrape_flow can blow its timeout. Retry the whole flow on a
        # brand new page, so that a wedged renderer, a half-open Export modal
        # or any other stuck client state can't be inherited by the retry.
        await _retrying(
            lambda: self._scrape_once(browser_context),
            what=f"{self.name} (report_year={self.filters.report_year.value})",
            attempts=self.attempts,
            backoff=self.retry_backoff,
        )

    async def _scrape_once(self, browser_context: BrowserContext) -> None:
        """One attempt at scraping + saving, on a page of its own.

        A fresh page per attempt is cheap (page creation is milliseconds
        against a scrape measured in minutes) and it means a retry starts
        from a genuinely clean renderer rather than from whatever state the
        previous attempt died in.
        """
        page = await browser_context.new_page()
        try:
            await self._download_and_save(page)
        finally:
            # The download has already been saved to self.destination by now,
            # so it's safe to drop the page it came from.
            await page.close()

    async def _download_and_save(self, page: Page) -> None:
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
        attempts: int = DEFAULT_ATTEMPTS,
        retry_backoff: float = DEFAULT_RETRY_BACKOFF,
    ):
        super().__init__(
            filters=filters,
            destination=destination,
            attempts=attempts,
            retry_backoff=retry_backoff,
        )
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
                    attempts=self.attempts,
                    retry_backoff=self.retry_backoff,
                )
                for year in YearEnum
                if year != YearEnum.any
            ]
            for s in sub_scrapers:
                await s(browser_context)
            self._merge_csvs([s.destination for s in sub_scrapers], self.destination)

        if self.tempdir is None:
            with tempfile.TemporaryDirectory() as tmpdir:
                await f(tmpdir)
        else:
            await f(self.tempdir)

    def _merge_csvs(self, srcs: Iterable[Path], destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with open(destination, "w") as f:
            writer = csv.writer(f)
            writer.writerow([col.strip('"') for col in self._HEADER_ROW.split(",")])
            i = 1
            for src in srcs:
                with open(src, "r") as srcf:
                    reader = csv.reader(srcf)
                    # skip the header row
                    next(reader)
                    for row in reader:
                        # the first column is an index, but that is only valid per-file
                        # so when we combine them, we need to renumber them
                        _index, *rest = row
                        writer.writerow([i, *rest])
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
    attempts: int = DEFAULT_ATTEMPTS,
    retry_backoff: float = DEFAULT_RETRY_BACKOFF,
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
    attempts : int
        How many times to try each individual scrape before giving up.
    retry_backoff : float
        Base seconds for the exponential backoff between retries.
    """
    directory = Path(directory)
    classes: list[type[_ScraperBase]] = [
        CampaignFormScraper,
        IncomeScraper,
        CandidateRegistrationScraper,
        LetterOfIntentScraper,
        GroupRegistrationScraper,
        EntityRegistrationScraper,
        DebtScraper,
        ExpenditureScraper,
    ]
    scrapers = [
        cls(
            destination=directory / f"{cls.name}.csv",
            attempts=attempts,
            retry_backoff=retry_backoff,
        )
        for cls in classes
    ]

    async def run():
        async with make_browser_async(headless=headless) as browser_context:
            await run_scrapers(scrapers, browser_context=browser_context)

    asyncio.run(run())


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    scrape_all()
