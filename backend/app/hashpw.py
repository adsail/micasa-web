"""Generate the bcrypt hash for AUTH_PASSWORD_HASH.

    python -m app.hashpw

Prompts twice (input is never echoed, never logged, never stored) and prints
the hash to stdout. Copy that value into AUTH_PASSWORD_HASH.
"""

import getpass
import sys

import bcrypt

# bcrypt only consumes the first 72 bytes of a password; refuse longer input
# instead of silently truncating it.
MAX_PASSWORD_BYTES = 72


def main():
    try:
        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Confirm password: ")
    except (KeyboardInterrupt, EOFError):
        print("", file=sys.stderr)
        return 1

    if not password:
        print("password must not be empty", file=sys.stderr)
        return 1
    if password != confirm:
        print("passwords do not match", file=sys.stderr)
        return 1
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        print(f"password must be at most {MAX_PASSWORD_BYTES} bytes", file=sys.stderr)
        return 1

    print(bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
