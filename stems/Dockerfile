# ECHO's stem service (README.md). Build context: this directory.
FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# UVR-MDX-NET-Inst_HQ_3 (Ultimate Vocal Remover project, MIT), pinned by hash.
ARG MODEL_URL=https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx
ARG MODEL_SHA256=317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc
RUN mkdir -p /models \
 && curl -fsSL -o /models/UVR-MDX-NET-Inst_HQ_3.onnx "$MODEL_URL" \
 && echo "$MODEL_SHA256  /models/UVR-MDX-NET-Inst_HQ_3.onnx" | sha256sum -c -

COPY separate.py server.py /app/
WORKDIR /app
ENV PYTHONUNBUFFERED=1 ECHO_STEMS_DIR=/stems ECHO_STEMS_THREADS=2 ECHO_STEMS_PORT=8090
USER 1000:1000
EXPOSE 8090
HEALTHCHECK --interval=60s --timeout=5s CMD curl -fsS http://127.0.0.1:8090/health || exit 1
CMD ["python", "server.py"]
