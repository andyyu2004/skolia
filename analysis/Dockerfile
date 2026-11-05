# skolia-ingest, for linux/amd64 and linux/arm64. Build from the repo root:
#   docker build -f analysis/Dockerfile --target ingest .
# Stage "ingest" (docker compose): models download on first start into
# /root/.cache/huggingface (mount a volume there), the lexicon is mounted.
# Stage "cloudflare" (the default, built by wrangler): models and lexicon are in the
# image, so a container that wakes for a job needs nothing from outside but R2.

# --- Morfeusz from source ---------------------------------------------------------
# PyPI's morfeusz2 has a Linux wheel for x86-64 only, so the library and its Python
# binding are compiled here for whatever platform the image is built for. The
# dictionary is SGJP's own compiled one from the same release as the PyPI wheel
# (morfeusz2 1.99.15, build 20260601), installed where the library looks for it.
FROM python:3.12.13-slim AS morfeusz

ARG MORFEUSZ_RELEASE=20260601
ARG MORFEUSZ_SRC_SHA256=733f24fccd1031a87b81fc4f1c6451157633bdf67308f81ffa1e712e54db2b71
ARG MORFEUSZ_DICT_SHA256=06492b2267183af375e370cc06530b87d93fd0ac0ca904370a775f4c305d8a2b

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates cmake curl g++ make swig unzip \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir build==1.6.1 setuptools==84.2.1 wheel==0.48.0

WORKDIR /build
RUN base=https://download.sgjp.pl/morfeusz/$MORFEUSZ_RELEASE \
 && curl -fsSL -o src.tar.gz $base/morfeusz-src-$MORFEUSZ_RELEASE.tar.gz \
 && curl -fsSL -o dict.tgz $base/morfeusz2-dictionary-sgjp-$MORFEUSZ_RELEASE.tgz \
 && echo "$MORFEUSZ_SRC_SHA256  src.tar.gz" | sha256sum -c - \
 && echo "$MORFEUSZ_DICT_SHA256  dict.tgz" | sha256sum -c - \
 && tar xzf src.tar.gz \
 && mkdir dictionaries && tar xzf dict.tgz -C dictionaries

# Patches to the upstream build:
# - it always configures the Java binding (needs a JDK) and the GUI: drop both
# - the wheel's platform tag is hard-coded to manylinux_2_28_x86_64: use this machine's
# SKIP_DICTIONARY_BUILDING without INPUT_DICTIONARIES gives a library that loads
# sgjp-a.dict / sgjp-s.dict from /usr/local/share/morfeusz2/dictionaries at runtime.
RUN sed -i '/add_subdirectory (java)/d' Morfeusz/morfeusz/wrappers/CMakeLists.txt \
 && sed -i '/add_subdirectory (gui)/d' Morfeusz/CMakeLists.txt \
 && sed -i "s/^plat_name=.*/plat_name=linux_$(uname -m)/" Morfeusz/morfeusz/wrappers/python3/setup.cfg \
 && mkdir -p /wheels \
 && cmake -S Morfeusz -B out \
      -D CMAKE_BUILD_TYPE=Release \
      -D DEFAULT_DICT_NAME=sgjp \
      -D DICT_VERSION=$MORFEUSZ_RELEASE \
      -D SKIP_DICTIONARY_BUILDING=1 \
      -D SKIP_TESTING=1 \
      -D DEFAULT_DICT_DIR=/build/dictionaries \
      -D PY=3.12 \
      -D TARGET_DIR=/wheels \
 && make -C out -j"$(nproc)" package-python3-fatwhl

# --- skolia-ingest ----------------------------------------------------------------
FROM python:3.12.13-slim AS ingest

COPY --from=ghcr.io/astral-sh/uv:0.12.1 /uv /usr/local/bin/uv
COPY --from=morfeusz /build/dictionaries/ /usr/local/share/morfeusz2/dictionaries/
COPY --from=morfeusz /wheels/ /wheels/

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never

# Dependencies first, so code changes don't reinstall PyTorch. morfeusz2 comes from
# the wheel built above instead of PyPI.
COPY analysis/pyproject.toml analysis/uv.lock analysis/.python-version ./
# uv's download cache lives in a build cache mount, not in the image (about 1 GB)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project --no-install-package morfeusz2

COPY analysis/src ./src
COPY analysis/typings ./typings
# uv sync removes packages the lockfile doesn't install, so the wheel goes in last
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-package morfeusz2 \
 && uv pip install --python .venv/bin/python --no-deps /wheels/morfeusz2-*.whl

ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
CMD ["skolia-ingest"]

# --- the Cloudflare container -------------------------------------------------------
FROM ingest AS cloudflare

# The models the default parser (COMBO) loads, at fixed revisions, one layer each:
# Cloudflare's registry times out committing a single 3 GB layer
COPY analysis/scripts/fetch_model.py /tmp/
RUN python /tmp/fetch_model.py FacebookAI/xlm-roberta-base e73636d4f797dec63c3081bb6ed5c7b0bb3f2089 \
      config.json model.safetensors sentencepiece.bpe.model tokenizer.json tokenizer_config.json
RUN python /tmp/fetch_model.py clarin-pl/combo-nlp-xlm-roberta-base-polish-pdb-ud2.18 f88e8ac3f57ea0e44e843f9ce85356963825ecae
RUN python /tmp/fetch_model.py clarin-pl/combo-seg-xlm-roberta-base-polish-pdb-ud2.18 dc9865fad8aa7978f96fa69bc4e30a1943535f8e
RUN python /tmp/fetch_model.py clarin-pl/combo-nlp-models 668b5a5d5f1afb5b57b0d9b04062c5ed3f812005
# Fails the build if the parser needs anything not fetched above
RUN HF_HUB_OFFLINE=1 python -c "from skolia_analysis import pl; pl.parser(pl.DEFAULT_MODEL)"
COPY data/lexicon/pl.sqlite data/lexicon/pl-valency.json /lexicon/

ENV HF_HUB_OFFLINE=1 \
    SKOLIA_HTTP_PORT=8080 \
    SKOLIA_LEXICON=/lexicon/pl.sqlite \
    SKOLIA_VALENCY=/lexicon/pl-valency.json
EXPOSE 8080
