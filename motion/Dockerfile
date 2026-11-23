# ECHO's motion service (README.md). Build context: this directory.
FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Depth Anything V2 Small (Apache-2.0) as ONNX, from onnx-community/depth-anything-v2-small, pinned
# by revision and by hash (99 MB).
ARG MODEL_REVISION=4472b7362082ad9968fee890ca0f1e5aca36b93d
ARG MODEL_SHA256=afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c
RUN mkdir -p /models \
 && curl -fsSL -o /models/depth-anything-v2-small.onnx \
      "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/$MODEL_REVISION/onnx/model.onnx" \
 && echo "$MODEL_SHA256  /models/depth-anything-v2-small.onnx" | sha256sum -c -

COPY motion.py server.py /app/
WORKDIR /app
ENV PYTHONUNBUFFERED=1 ECHO_MOTION_DIR=/motion ECHO_MOTION_THREADS=2 ECHO_MOTION_PORT=8091 \
    ECHO_MOTION_CODEC=hevc ECHO_MOTION_MODEL=/models/depth-anything-v2-small.onnx
USER 1000:1000
EXPOSE 8091
HEALTHCHECK --interval=60s --timeout=5s CMD curl -fsS http://127.0.0.1:8091/health || exit 1
CMD ["python", "server.py"]
