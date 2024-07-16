import argparse
import logging
from pathlib import Path

from apoc_data.scrape import scrape_all
from apoc_data.scrape._scraper import DEFAULT_DIRECTORY


def main():
    parser = argparse.ArgumentParser(
        description="Download data from the Alaska Public Offices Commission"
    )
    parser.add_argument(
        "--directory",
        type=str,
        default=DEFAULT_DIRECTORY,
        help="The directory to save the data to",
    )
    parser.add_argument(
        "--headless",
        "--no-headless",
        dest="headless",
        default=True,
        action=_BooleanAction,
        help="Run the browser in headless mode",
    )
    args = parser.parse_args()
    directory = Path(args.directory).absolute()
    if directory.is_file():
        raise ValueError("The directory can't be a file")
    logging.basicConfig(level=logging.INFO)
    scrape_all(directory, headless=args.headless)


# from https://thisdataguy.com/2017/07/03/no-options-with-argparse-and-python/
class _BooleanAction(argparse.Action):
    def __init__(self, option_strings, dest, nargs=None, **kwargs):
        super(_BooleanAction, self).__init__(option_strings, dest, nargs=0, **kwargs)

    def __call__(self, parser, namespace, values, option_string=None):
        setattr(
            namespace, self.dest, False if option_string.startswith("--no") else True
        )


if __name__ == "__main__":
    main()
