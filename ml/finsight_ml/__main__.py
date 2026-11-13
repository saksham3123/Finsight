"""Command line: python -m finsight_ml <command>

  fetch      download/refresh price history (Yahoo Finance for stocks, Binance for crypto)
  evaluate   walk-forward evaluation of all direction models and baselines; writes reports/
  range-evaluate  walk-forward evaluation of the 80% range models; writes reports/range_<type>.json
  range-tests     add coverage tests to the saved range report from the saved forecasts (no refitting)
  train      fit the selected model per asset type on all history; writes models/
  predict    score the latest day of every asset; writes reports/predictions.json
  publish    push real prices and the latest predictions to the FinSight backend
  all        fetch → evaluate → train → predict (add --publish to also publish)
"""

import argparse
import sys

from . import pipeline, publish, range_pipeline, report
from .models import ALL_MODELS
from .ranges import RANGE_MODELS
from .data import DataError, fetch_all


def _types(args):
    return [args.type] if args.type else list(pipeline.ASSET_TYPES)


def cmd_fetch(args):
    print("Fetching price history…")
    summary = fetch_all(refresh=args.refresh, only_type=args.type)
    print(f"Fetched {len(summary['fetched'])}, used today's cache for {len(summary['cached'])}, failed {len(summary['failed'])}.")


def cmd_evaluate(args):
    for asset_type in _types(args):
        print(f"Walk-forward evaluation ({asset_type})…")
        pipeline.evaluate(asset_type, models=args.models)
    print(report.write_markdown())


def cmd_range_evaluate(args):
    for asset_type in _types(args):
        print(f"Range walk-forward evaluation ({asset_type})…")
        range_pipeline.evaluate_range(asset_type, models=args.models)
    print(report.write_markdown())


def cmd_range_tests(args):
    for asset_type in _types(args):
        print(f"Coverage tests ({asset_type})…")
        range_pipeline.add_coverage_tests(asset_type)
    print(report.write_markdown())


def cmd_train(args):
    for asset_type in _types(args):
        pipeline.train(asset_type, args.model)
        range_pipeline.train_range(asset_type, getattr(args, "range_model", None))


def cmd_predict(args):
    advisories = pipeline.predict()
    print(f"\n{'Asset':<11}{'Type':<8}{'Signal':<11}{'P(up)':>7}{'Conf.':>7}{'Risk':>7}  Data to")
    for a in advisories:
        print(f"{a['symbol']:<11}{a['assetType']:<8}{a['signal']:<11}{a['probabilityUp']:>7.2f}"
              f"{a['confidence']:>7.2f}{a['riskScore']:>7.2f}  {a['dataUntil']}")
    print("\nResearch prototype, not financial advice.")
    return advisories


def cmd_publish(args, advisories=None):
    print("Publishing real prices to the backend…")
    publish.publish_prices()
    if advisories is None:
        advisories = pipeline.predict(log=lambda *_: None)
    print(f"Published {publish.publish_advisories(advisories)} advisories.")


def cmd_all(args):
    args.models = None
    cmd_fetch(args)
    cmd_evaluate(args)
    cmd_range_evaluate(args)
    cmd_train(args)
    advisories = cmd_predict(args)
    if args.publish:
        cmd_publish(args, advisories)


def main(argv=None):
    # Windows consoles default to cp1252, which cannot print characters such as "→".
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(prog="finsight_ml", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("fetch", "evaluate", "range-evaluate", "range-tests", "train", "predict", "publish", "all"):
        p = sub.add_parser(name)
        p.add_argument("--type", choices=pipeline.ASSET_TYPES, help="limit to stocks or crypto")
        if name in ("fetch", "all"):
            p.add_argument("--refresh", action="store_true", help="re-download even if fetched today")
        if name in ("train", "all"):
            p.add_argument("--model", choices=list(ALL_MODELS), help="override the selected model")
        if name == "evaluate":
            p.add_argument("--models", nargs="+", choices=list(ALL_MODELS),
                           help="evaluate only these models and merge them into the existing report")
        if name == "range-evaluate":
            p.add_argument("--models", nargs="+", choices=list(RANGE_MODELS),
                           help="evaluate only these range models and merge them into the existing report")
        if name == "train":
            p.add_argument("--range-model", choices=list(RANGE_MODELS), help="override the selected range model")
        if name == "all":
            p.add_argument("--publish", action="store_true", help="also publish to the backend")
    args = parser.parse_args(argv)
    commands = {"fetch": cmd_fetch, "evaluate": cmd_evaluate, "range-evaluate": cmd_range_evaluate, "range-tests": cmd_range_tests, "train": cmd_train, "predict": cmd_predict, "publish": cmd_publish, "all": cmd_all}
    try:
        commands[args.command](args)
    except DataError as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
