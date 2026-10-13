#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""影视剧作工坊 · 链路脚本入口。

    python chain.py assets
    python chain.py axis "首尾帧，即梦"
    python chain.py frame spec.json
    python chain.py delivery spec.json --mode t2v --audio no-bgm
    python chain.py check out.txt --mode t2v --audio full

只依赖 Python 3.8+ 标准库。
"""
import sys
from pathlib import Path

# 允许 `python chain.py` 直接从脚本目录运行
sys.path.insert(0, str(Path(__file__).resolve().parent))

from wfkit.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
