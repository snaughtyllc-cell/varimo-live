#!/usr/bin/env python3
"""Operator-only: issue a one-hour recovery link into a NEW private file.

Never paste its contents into logs. Obtain approval for the delivery destination
before issuance. Existing password stays valid until the link is redeemed.
"""
import argparse
import os

from variant_maker.server.tenants import TenantStore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--store', required=True, help='Production auth/tenants.json')
    parser.add_argument('--email', required=True)
    parser.add_argument('--output', required=True, help='New private file, never stdout')
    args = parser.parse_args()
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        token = TenantStore(args.store).issue_password_reset(args.email)
        with os.fdopen(fd, 'w') as out:
            fd = None
            out.write('https://varimo.io/api/auth/password/reset#' + token + '\n')
    except Exception:
        if fd is not None:
            os.close(fd)
        os.unlink(args.output)
        raise
    print('One-hour recovery link saved to the requested private file; no password changed.')


if __name__ == '__main__':
    main()
