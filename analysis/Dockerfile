# syntax=docker/dockerfile:1
# (1.10+ for secret mounts as environment variables)
# skolia-ingest, the Cloudflare container (wrangler builds it for wrangler dev;
# infra/deploy-ingest.sh for staging and production). For linux/amd64 and linux/arm64,
# from the repo root:
#   docker build -f analysis/Dockerfile .
# Models and lexicon are in the image, so a container that wakes for a job needs nothing
# from outside but R2. data/lexicon/ must be built first (mise run data).

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

# --- the models --------------------------------------------------------------------
# The models the default parser (COMBO) loads, at fixed revisions. Downloaded here, with
# only huggingface_hub (the version uv.lock has), and copied into the image below ahead
# of everything else: each model's layer then depends on nothing but its files, so a
# dependency or code change doesn't make a new 1 GB layer to push. The base model's
# weights aren't needed: COMBO's checkpoints replace them (combo_parser.py). The optional
# hf_token build secret (--secret id=hf_token,env=HF_TOKEN) raises the Hub's rate
# limits; it isn't stored in the image and doesn't change the cache key.
# Each model gets a cache of its own: huggingface_hub keeps large files in the cache's
# shared blobs/, outside the model's directory, so this keeps them apart for the copy.
FROM python:3.12.13-slim AS models

RUN pip install --no-cache-dir huggingface-hub==2.4.0 hf-xet==1.8.0
COPY analysis/scripts/fetch_model.py /tmp/
RUN --mount=type=secret,id=hf_token,env=HF_TOKEN \
    HF_HUB_CACHE=/models/xlm-roberta-base python /tmp/fetch_model.py \
      FacebookAI/xlm-roberta-base e73636d4f797dec63c3081bb6ed5c7b0bb3f2089 \
      config.json sentencepiece.bpe.model tokenizer.json tokenizer_config.json
RUN --mount=type=secret,id=hf_token,env=HF_TOKEN \
    HF_HUB_CACHE=/models/combo-nlp python /tmp/fetch_model.py \
      clarin-pl/combo-nlp-xlm-roberta-base-polish-pdb-ud2.18 f88e8ac3f57ea0e44e843f9ce85356963825ecae
RUN --mount=type=secret,id=hf_token,env=HF_TOKEN \
    HF_HUB_CACHE=/models/combo-seg python /tmp/fetch_model.py \
      clarin-pl/combo-seg-xlm-roberta-base-polish-pdb-ud2.18 dc9865fad8aa7978f96fa69bc4e30a1943535f8e
RUN --mount=type=secret,id=hf_token,env=HF_TOKEN \
    HF_HUB_CACHE=/models/combo-nlp-models python /tmp/fetch_model.py \
      clarin-pl/combo-nlp-models 668b5a5d5f1afb5b57b0d9b04062c5ed3f812005

# --- skolia-ingest ----------------------------------------------------------------
FROM python:3.12.13-slim AS ingest

# The model caches merged into one, a layer each: Cloudflare's registry times out
# committing a single 3 GB layer
ARG HUB=/root/.cache/huggingface/hub
COPY --from=models /models/xlm-roberta-base/ $HUB/
COPY --from=models /models/combo-nlp/ $HUB/
COPY --from=models /models/combo-seg/ $HUB/
COPY --from=models /models/combo-nlp-models/ $HUB/

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

ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1
# Fails the build if the parser needs a model file not fetched above
RUN python -c "from skolia_analysis.lang.pl import plugin as pl; pl.parser(pl.DEFAULT_MODEL)"
COPY data/lexicon/pl.sqlite data/lexicon/pl-valency.json /lexicon/

ENV SKOLIA_HTTP_PORT=8080 \
    SKOLIA_LANGS=pl \
    SKOLIA_DATA=/lexicon
EXPOSE 8080
CMD ["skolia-ingest"]
