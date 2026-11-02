# TempDesk portal: one image, two modes (PORTAL_MODE=guest or admin).
# Build from the repository root so the bundled docs can be copied:
#   docker build -f portal/Dockerfile -t tempdesk-portal .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORTAL_DATA_DIR=/data \
    DOCS_DIR=/app/bundled-docs

# git keeps the undo history repository on the data volume.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 10001 tempdesk \
 && useradd --system --uid 10001 --gid tempdesk --home-dir /app --shell /usr/sbin/nologin tempdesk

WORKDIR /app
COPY portal/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY portal/app ./app
# Offline docs browser and changelog viewer.
# The wildcard keeps the build working before a CHANGELOG.md exists.
COPY docs CHANGEL[O]G.m[d] ./bundled-docs/
# Base64 codec shared with the website (a vendored copy already exists in app/static/js;
# this keeps the image in step when the site module is present).
COPY site/assets/zip.js ./app/static/js/zip.js

RUN mkdir -p /data && chown tempdesk:tempdesk /data && chmod 700 /data
USER tempdesk
VOLUME ["/data"]

EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request,sys; p=os.environ.get('PORT') or ('8081' if os.environ.get('PORTAL_MODE')=='admin' else '8080'); sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+p+'/healthz', timeout=4).status==200 else 1)"

CMD ["python", "-m", "app.main"]
