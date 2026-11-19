ARG ALPINE_IMAGE
FROM ${ALPINE_IMAGE} AS assemble
ARG APPLIANCE_PLATFORM
ARG PORTAL_VERSION
COPY . /inputs/
RUN mkdir /output && sh /inputs/appliance/build-disk.sh "${APPLIANCE_PLATFORM}" "${PORTAL_VERSION}"

FROM scratch
COPY --from=assemble /output/ /
