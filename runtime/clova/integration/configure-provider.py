#!/usr/bin/env python3
"""Store an already-issued API key. This command cannot issue provider keys."""
import argparse
import getpass
import json
import os
from pathlib import Path
import shlex
import stat
import sys
import tempfile
import warnings

PROVIDERS = {
    "groq": "GROQ_API_KEY_FILE",
    "openrouter": "OPENROUTER_API_KEY_FILE",
    "zai": "ZAI_API_KEY_FILE",
}
DEFAULT_DIR = Path.home() / ".config/elda-clova/providers"


def prepare(directory):
    directory = Path(directory).absolute()
    if directory.is_symlink():
        raise ValueError("저장 폴더에 심볼릭 링크를 사용할 수 없습니다.")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.stat().st_uid != os.getuid():
        raise ValueError("현재 사용자 소유의 폴더만 사용할 수 있습니다.")
    directory.chmod(0o700)
    return directory


def atomic_private(path, value):
    if path.is_symlink():
        raise ValueError("저장 파일에 심볼릭 링크를 사용할 수 없습니다.")
    fd, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def initialize(directory):
    directory = prepare(directory)
    text = "# API 키 값은 포함하지 않습니다. 각 파일은 실제 키 발급 후 생성됩니다.\n"
    text += "".join(f"export {env}={shlex.quote(str(directory / (provider + '.key')))}\n"
                    for provider, env in PROVIDERS.items())
    atomic_private(directory / "providers.env", text)
    return directory


def save_key(directory, provider, value, replace=False):
    if provider not in PROVIDERS:
        raise ValueError("지원하지 않는 공급자입니다.")
    value = value.strip()
    if not value or len(value) > 8192 or any(c.isspace() or ord(c) < 32 for c in value):
        raise ValueError("공백 없는 한 줄의 발급된 API 키를 입력하세요.")
    directory = initialize(directory)
    path = directory / (provider + ".key")
    if path.exists() and not replace:
        raise ValueError("키가 이미 있습니다. 교체하려면 --replace를 명시하세요.")
    atomic_private(path, value + "\n")
    return path


def status(directory):
    result = []
    for provider in PROVIDERS:
        path = directory / (provider + ".key")
        configured = False
        if path.exists() and not path.is_symlink():
            info = path.stat()
            configured = stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and bool(path.read_text().strip())
        result.append({"provider": provider, "path": str(path), "stored": configured,
                       "liveValidation": "not_verified"})
    return result


def main():
    parser = argparse.ArgumentParser(description="발급된 API 키를 비공개 파일로 저장합니다. 키 발급 기능은 아닙니다.")
    parser.add_argument("provider", nargs="?", choices=PROVIDERS)
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIR)
    parser.add_argument("--init", action="store_true", help="키 없이 저장 폴더와 경로 설정만 준비")
    parser.add_argument("--status", action="store_true", help="키 값 없이 저장 여부만 확인")
    parser.add_argument("--replace", action="store_true", help="기존 키 교체")
    args = parser.parse_args()
    try:
        if args.init:
            initialize(args.directory)
        if args.provider:
            if not sys.stdin.isatty():
                raise ValueError("키 입력은 터미널에서 실행하세요. 명령 인자나 파이프로 키를 전달하지 마세요.")
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                value = getpass.getpass(f"{args.provider}에서 발급한 API 키 (화면에 표시되지 않음): ")
            path = save_key(args.directory, args.provider, value, args.replace)
            print(f"저장 완료: {path} (권한 600). 실제 API 검증은 별도입니다.")
        if args.status or args.init:
            print(json.dumps(status(args.directory.absolute()), ensure_ascii=False, indent=2))
        if not (args.provider or args.init or args.status):
            parser.print_help()
    except (ValueError, OSError, getpass.GetPassWarning, EOFError) as exc:
        # Never print input, API responses or exception data from credential parsing.
        print(str(exc) if isinstance(exc, ValueError) else "키 저장 실패: 파일 권한과 터미널을 확인하세요.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
