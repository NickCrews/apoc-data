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
    await expect(page.get_by_text("Press 'Search' to Load Results.")).to_be_hidden()

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
    def __call__(self, browser_context: BrowserContext) -> None: ...


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
    name: ClassVar[str]

    def __init__(
        self,
        *,
        filters: ScrapeFilters | None = None,
        destination: str | Path,
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
            # with *.csv barf. So we simply don't include it.
            # We could abort the download further upstream if we wanted.
            _logger.info(f"No results. Not writing to {self.destination}")
        else:
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


class CandidateRegistrationScraper(_ScraperBase):
    _HOME_URL = "https://aws.state.ak.us/ApocReports/Registration/CandidateRegistration/CRForms.aspx"
    name = "candidate_registration"


class LetterOfIntentScraper(_ScraperBase):
    _HOME_URL = (
        "https://aws.state.ak.us/ApocReports/Registration/LetterOfIntent/LOIForms.aspx"
    )
    name = "letter_of_intent"


class GroupRegistrationScraper(_ScraperBase):
    _HOME_URL = "https://aws.state.ak.us/ApocReports/Registration/GroupRegistration/GRForms.aspx"
    name = "group_registration"


class EntityRegistrationScraper(_ScraperBase):
    _HOME_URL = "https://aws.state.ak.us/ApocReports/Registration/EntityRegistration/ERForms.aspx"
    name = "entity_registration"


class DebtScraper(_ScraperBase):
    _HOME_URL = "https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDDebt.aspx"
    name = "debt"


class ExpenditureScraper(_ScraperBase):
    _HOME_URL = (
        "https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDExpenditures.aspx"
    )
    name = "expenditures"


class IncomeScraper(_ScraperBase):
    _HOME_URL = "https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDIncome.aspx"
    name = "income"

    def __init__(self, *, filters: ScrapeFilters, destination: str | Path):
        super().__init__(filters=filters, destination=destination)
        if self.filters.report_year == YearEnum.any:
            raise ValueError("For Receipts, can't use report_year=Any")


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
    - expenditure.csv
    - debt.csv
    - income_{year}.csv for each year where there is data

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
        CandidateRegistrationScraper,
        LetterOfIntentScraper,
        GroupRegistrationScraper,
        EntityRegistrationScraper,
        DebtScraper,
        ExpenditureScraper,
    ]
    scrapers = [cls(destination=directory / f"{cls.name}.csv") for cls in classes] + [
        IncomeScraper(
            filters=ScrapeFilters(report_year=year),
            destination=directory / f"{IncomeScraper.name}_{year.value}.csv",
        )
        for year in YearEnum
        if year != YearEnum.any
    ]

    async def run():
        async with make_browser_async(headless=headless) as browser_context:
            await run_scrapers(scrapers, browser_context=browser_context)

    asyncio.run(run())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    scrape_all()
