#!/usr/bin/env python3
"""S3 CORS policy preflight tester."""

import argparse
import sys
import urllib.error
import urllib.request

# 1. Configuration (UPDATE THESE VALUES)
S3_BUCKET_NAME = "sirgis-cd-transfer"  # e.g. "my-awesome-storage"
AWS_REGION = "ap-southeast-2"  # e.g. "us-east-1" or "eu-west-1"
ORIGIN_URL = "https://dcworldwide.github.io"  # Your web app's origin domain
METHOD_TO_TEST = "PUT"  # PUT (Upload), GET (Download), DELETE, etc.

CYAN = "\033[36m"
GRAY = "\033[90m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
RESET = "\033[0m"


def header_value(headers, name):
    value = headers.get(name)
    if value is None:
        return None
    if isinstance(value, list):
        return ", ".join(value)
    return str(value)


def method_allowed(allowed_methods, method):
    if not allowed_methods:
        return False
    if allowed_methods.strip() == "*":
        return True
    tokens = [part.strip().upper() for part in allowed_methods.split(",")]
    return method.upper() in tokens


def check_cors(bucket, region, origin, method):
    target_url = f"https://{bucket}.s3.{region}.amazonaws.com/"
    headers = {
        "Origin": origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "authorization, content-type, x-amz-date",
    }

    print(f"\n{CYAN}Sending OPTIONS preflight check to S3 bucket: {bucket}...{RESET}")
    print(f"{GRAY}Simulating web app at origin: {origin}{RESET}")
    print(f"{GRAY}Target: {target_url}{RESET}")

    request = urllib.request.Request(
        target_url, method="OPTIONS", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status_code = response.status
            response_headers = response.headers
    except urllib.error.HTTPError as exc:
        print(
            f"\n{RED}[FAIL] CORS Check Failed or Bucket rejected the preflight!{RESET}")
        print(f"{RED}HTTP Status Code: {exc.code}{RESET}")
        if exc.code == 403:
            print(
                f"{YELLOW}Reason: S3 returned 403 Forbidden. The CORS policy on this bucket either:{RESET}")
            print(f"{YELLOW}  1. Does not match the Origin '{origin}'{RESET}")
            print(f"{YELLOW}  2. Does not allow the HTTP method '{method}'{RESET}")
            print(
                f"{YELLOW}  3. Does not allow custom headers like 'x-amz-date' or 'authorization'{RESET}")
        else:
            detail = exc.read().decode("utf-8", errors="replace").strip()
            if detail:
                print(f"{RED}Error details: {detail}{RESET}")
        return 1
    except urllib.error.URLError as exc:
        print(
            f"\n{RED}[FAIL] CORS Check Failed or Bucket rejected the preflight!{RESET}")
        print(f"{RED}Error details: {exc.reason}{RESET}")
        return 1

    allowed_origin = header_value(
        response_headers, "Access-Control-Allow-Origin")
    allowed_methods = header_value(
        response_headers, "Access-Control-Allow-Methods")
    allowed_headers = header_value(
        response_headers, "Access-Control-Allow-Headers")

    print(
        f"\n{GREEN}[SUCCESS] CORS is properly configured for this web app!{RESET}")
    print(f"{GRAY}--------------------------------------------------------{RESET}")
    print(f"HTTP Status:     {status_code}")
    print(f"Allowed Origin:  {allowed_origin}")
    print(f"Allowed Methods: {allowed_methods}")
    print(f"Allowed Headers: {allowed_headers}")
    print(f"{GRAY}--------------------------------------------------------{RESET}\n")

    if allowed_origin not in ("*", origin):
        print(
            f"{YELLOW}[WARNING] Expected origin '{origin}' but got '{allowed_origin}'.{RESET}"
        )
    if not method_allowed(allowed_methods, method):
        print(
            f"{YELLOW}[WARNING] Method '{method}' was not explicitly returned in Allowed-Methods.{RESET}"
        )
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="S3 CORS policy preflight tester")
    parser.add_argument("--bucket", default=S3_BUCKET_NAME)
    parser.add_argument("--region", default=AWS_REGION)
    parser.add_argument("--origin", default=ORIGIN_URL)
    parser.add_argument("--method", default=METHOD_TO_TEST)
    args = parser.parse_args()
    sys.exit(check_cors(args.bucket, args.region, args.origin, args.method))


if __name__ == "__main__":
    main()
