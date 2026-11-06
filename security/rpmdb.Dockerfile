ARG BASE=al2023-distroless-java:prototype
FROM $BASE
# Context contains only the native RPM database and its locked release marker.
# This is a separate scan experiment; the original runtime image is unchanged.
COPY . /
