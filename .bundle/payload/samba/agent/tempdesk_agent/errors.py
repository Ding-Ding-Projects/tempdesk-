class ApiError(Exception):
    """An error with an HTTP status and an API error code from docs/API.md."""

    STATUS = {
        "bad_request": 400,
        "unauthorized": 401,
        "forbidden": 403,
        "not_found": 404,
        "conflict": 409,
        "rate_limited": 429,
        "internal": 500,
    }

    def __init__(self, code: str, message: str = "", status: int | None = None):
        super().__init__(message or code)
        self.code = code
        self.message = message or code
        self.status = status or self.STATUS.get(code, 500)


def bad(msg):
    return ApiError("bad_request", msg)


def not_found(msg="not found"):
    return ApiError("not_found", msg)


def forbidden(msg="forbidden"):
    return ApiError("forbidden", msg)


def conflict(msg):
    return ApiError("conflict", msg)
