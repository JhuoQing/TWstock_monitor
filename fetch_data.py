#!/usr/bin/env python3
"""相容舊用法的入口：python fetch_data.py。實際邏輯在 pipeline/ 套件。"""
import sys

from pipeline.build import main

if __name__ == "__main__":
    sys.exit(main())
