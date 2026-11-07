# The ingest images, one per language (x86_64-linux: Cloudflare and wrangler dev run amd64)
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    pyproject-nix = {
      url = "github:pyproject-nix/pyproject.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    uv2nix = {
      url = "github:pyproject-nix/uv2nix";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    pyproject-build-systems = {
      url = "github:pyproject-nix/build-system-pkgs";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.uv2nix.follows = "uv2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nix2container = {
      url = "github:nlewo/nix2container";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      pyproject-nix,
      uv2nix,
      pyproject-build-systems,
      nix2container,
      ...
    }:
    let
      inherit (nixpkgs) lib;
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      n2c = nix2container.packages.${system};
      cacert = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";

      # The venv from uv.lock
      workspace = uv2nix.lib.workspace.loadWorkspace { workspaceRoot = ./.; };
      pythonSet =
        (pkgs.callPackage pyproject-nix.build.packages { python = pkgs.python312; }).overrideScope
          (
            lib.composeManyExtensions [
              pyproject-build-systems.overlays.wheel
              (workspace.mkPyprojectOverlay { sourcePreference = "wheel"; })
              # Only what the package is built from, so other changes here make no new image
              (_: prev: {
                skolia-analysis = prev.skolia-analysis.overrideAttrs {
                  src = lib.fileset.toSource {
                    root = ./.;
                    fileset = lib.fileset.unions [
                      ./pyproject.toml
                      ./src
                    ];
                  };
                };
              })
            ]
          );
      venv = pythonSet.mkVirtualEnv "skolia-ingest-env" workspace.deps.default;
      # Everything but the project, for a layer a code change doesn't touch
      depsEnv = pythonSet.mkVirtualEnv "skolia-ingest-deps" pythonSet.skolia-analysis.dependencies;

      # The models, pinned by revision and hash
      fetched =
        name: hash: script:
        pkgs.runCommand name
          {
            nativeBuildInputs = [ (pythonSet.mkVirtualEnv "hf-fetch" { huggingface-hub = [ ]; }) ];
            outputHashMode = "recursive";
            outputHashAlgo = "sha256";
            outputHash = hash;
            SSL_CERT_FILE = cacert;
            impureEnvVars = lib.fetchers.proxyImpureEnvVars ++ [ "HF_TOKEN" ];
          }
          ''
            export HOME=$TMPDIR HF_HOME=$TMPDIR/hf HF_HUB_DISABLE_TELEMETRY=1
            ${script}
          '';
      hfModel =
        name: repo: rev: files: hash:
        fetched "hf-${name}" hash ''
          HF_HUB_CACHE=$out python ${./scripts/fetch_model.py} ${repo} ${rev} ${lib.escapeShellArgs files}
          rm -rf $out/.locks
        '';
      hfModels = {
        # COMBO's checkpoints replace the base model's weights
        pl = [
          (hfModel "xlm-roberta-base" "FacebookAI/xlm-roberta-base"
            "e73636d4f797dec63c3081bb6ed5c7b0bb3f2089"
            [
              "config.json"
              "sentencepiece.bpe.model"
              "tokenizer.json"
              "tokenizer_config.json"
            ]
            "sha256-AiE0f3w7c5qhE004zkD5m/LT6tIpjL8BvEYWF7Qp6JE="
          )
          (hfModel "combo-nlp" "clarin-pl/combo-nlp-xlm-roberta-base-polish-pdb-ud2.18"
            "f88e8ac3f57ea0e44e843f9ce85356963825ecae"
            [ ]
            "sha256-x0WRMD7J+cw0IKdxl6sUBBiOQ/t3h9hUUQMI8smtJRE="
          )
          (hfModel "combo-seg" "clarin-pl/combo-seg-xlm-roberta-base-polish-pdb-ud2.18"
            "dc9865fad8aa7978f96fa69bc4e30a1943535f8e"
            [ ]
            "sha256-UZh3WxTUi6s0Ib9CL4XsqFwhzZSH/EhWoe5L6Kt/1xs="
          )
          (hfModel "combo-nlp-models" "clarin-pl/combo-nlp-models"
            "668b5a5d5f1afb5b57b0d9b04062c5ed3f812005"
            [ ]
            "sha256-6Bo6Gen1mi5AcUOvnnV4XvVmJlMUuOJhCvBOzk1Wu6g="
          )
        ];
        # The ELECTRA Stanza's models are built on, which Stanza loads from the Hub cache
        en = [
          (hfModel "electra-large" "google/electra-large-discriminator"
            "c13c3df7efadc2162f42588bd28eb4e187d602a5"
            [
              "config.json"
              "pytorch_model.bin"
              "tokenizer.json"
              "tokenizer_config.json"
              "vocab.txt"
            ]
            "sha256-68UE7QouKQsWJ6Qqums8FjEKdT5HCCb6z+RIGwehqQ8="
          )
        ];
      };
      # Stanza's default_accurate models for stanza 1.15.0 (uv.lock), which it finds
      # through resources.json
      stanzaModels = fetched "stanza-en" "sha256-CF2X1eOj/xrBEmj1g7yvokAgvpNVCgcighkYFdIib0U=" ''
        python ${./scripts/fetch_stanza.py} $out en 4003b0a5a175588fd8f6cb17fde741350f5fd725 \
          tokenize/combined_charlm.pt mwt/combined.pt lemma/combined_charlm.pt \
          pos/combined_electra-large.pt depparse/combined_electra-large.pt \
          pretrain/conll17.pt forward_charlm/1billion.pt backward_charlm/1billion.pt
      '';
      stanzaResources = pkgs.runCommand "stanza-resources" { } ''
        mkdir $out
        ln -s ${stanzaModels}/en $out/en
        ln -s ${
          pkgs.fetchurl {
            url = "https://raw.githubusercontent.com/stanfordnlp/stanza-resources/main/resources_1.15.0.json";
            sha256 = "ed01f17735f351e8f08fda331c3208091657d79420a2a10b4f9cfbc685f3d65d";
          }
        } $out/resources.json
      '';
      # A language's models merged into one Hub cache
      hub =
        lang:
        pkgs.runCommand "hf-hub-${lang}" { } ''
          mkdir $out
          ${lib.concatMapStrings (m: "ln -s ${m}/models--* $out/\n") hfModels.${lang}}
        '';

      # The lexicons, from the inputs pinned in inputs.sha256, which scripts/fetch_inputs.sh
      # puts in the store
      input = lib.listToAttrs (
        map (
          line:
          let
            sha256 = lib.head (lib.splitString "  " line);
            name = lib.last (lib.splitString "  " line);
          in
          lib.nameValuePair name (
            (pkgs.requireFile {
              inherit name sha256;
              message = "${name} isn't in the store: analysis/scripts/fetch_inputs.sh puts it there";
            }).overrideAttrs
              { meta = { }; }
          )
        ) (lib.filter (l: l != "") (lib.splitString "\n" (builtins.readFile ./inputs.sha256)))
      );
      lexicon = {
        en = pkgs.runCommand "skolia-lexicon-en" { nativeBuildInputs = [ venv ]; } ''
          mkdir $out
          skolia-build-lexicon en ${input."kaikki.org-dictionary-English.jsonl"} $out/en.sqlite
        '';
        pl =
          pkgs.runCommand "skolia-lexicon-pl"
            {
              nativeBuildInputs = [
                venv
                pkgs.unzip
              ];
            }
            ''
              mkdir $out
              skolia-build-lexicon pl ${input."kaikki.org-dictionary-Polish.jsonl"} $out/pl.sqlite
              unzip -q ${input."walenty_20180630-text.zip"} -d walenty
              skolia-build-valency walenty/walenty_20180630-text $out/pl-valency.json
            '';
      };

      env =
        lang:
        {
          PATH = "${venv}/bin";
          PYTHONUNBUFFERED = "1";
          HOME = "/tmp";
          SSL_CERT_FILE = cacert;
          HF_HUB_OFFLINE = "1";
          HF_HUB_CACHE = "${hub lang}";
          SKOLIA_HTTP_PORT = "8080";
          SKOLIA_LANGS = lang;
          SKOLIA_DATA = "${lexicon.${lang}}";
        }
        // lib.optionalAttrs (lang == "en") { STANZA_RESOURCES_DIR = "${stanzaResources}"; };

      # One layer per model (Cloudflare's registry times out committing a 3 GB layer),
      # PyTorch, the other dependencies and the lexicon; the code and the rest on top
      root = pkgs.runCommand "root" { } "mkdir -p $out/tmp";
      # Nested layers come first, so Python is the bottom layer: Cloudflare fails to unpack an
      # image whose first layer is over about 504 MiB (cloudflare/containers#265)
      pythonLayer = n2c.nix2container.buildLayer { deps = [ pkgs.python312 ]; };
      torchLayer = n2c.nix2container.buildLayer {
        deps = [ pythonSet.torch ];
        layers = [ pythonLayer ];
      };
      depsLayer = n2c.nix2container.buildLayer {
        deps = [ depsEnv ];
        layers = [ torchLayer ];
      };
      image =
        lang:
        n2c.nix2container.buildImage {
          name = "skolia-ingest-${lang}";
          layers =
            map (m: n2c.nix2container.buildLayer { deps = [ m ]; }) (
              hfModels.${lang} ++ lib.optional (lang == "en") stanzaModels
            )
            ++ [
              torchLayer
              depsLayer
              (n2c.nix2container.buildLayer { deps = [ lexicon.${lang} ]; })
            ];
          copyToRoot = [ root ];
          perms = [
            {
              path = root;
              regex = "/tmp";
              mode = "1777";
            }
          ];
          config = {
            Cmd = [ "${venv}/bin/skolia-ingest" ];
            Env = lib.mapAttrsToList (k: v: "${k}=${v}") (env lang);
            ExposedPorts."8080/tcp" = { };
          };
        };

      # Fails if the parser needs a model file the image doesn't have
      check =
        lang:
        pkgs.runCommand "skolia-ingest-check-${lang}"
          (removeAttrs (env lang) [ "PATH" ] // { nativeBuildInputs = [ venv ]; })
          ''
            export HOME=$TMPDIR
            python -c "from skolia_analysis import lang; p = lang.plugin('${lang}'); p.parser(p.DEFAULT_MODEL)"
            touch $out
          '';

      # What deploy-ingest pushes to the Cachix cache: an image's build but the models, which
      # would fill it. Nothing here references them (a push takes a path's whole closure).
      cacheable =
        lang:
        pkgs.linkFarmFromDrvs "cacheable-${lang}" [
          depsEnv
          venv
          lexicon.${lang}
          n2c.nix2container-bin
          n2c.skopeo-nix2container
        ];

      # Each machine copies the (x86_64-linux) images with its own skopeo
      perLang =
        host: f:
        lib.listToAttrs (
          map (lang: lib.nameValuePair "${f.prefix}-${lang}" (f.value lang)) [
            "pl"
            "en"
          ]
        );
      packages =
        host:
        perLang host {
          prefix = "ingest";
          value =
            lang:
            image lang
            // {
              copyTo = nixpkgs.legacyPackages.${host}.writeShellApplication {
                name = "copy-to";
                runtimeInputs = [ nix2container.packages.${host}.skopeo-nix2container ];
                text = ''skopeo --insecure-policy copy nix:${image lang} "$@"'';
              };
            };
        }
        // perLang host {
          prefix = "lexicon";
          value = lang: lexicon.${lang};
        }
        // perLang host {
          prefix = "cacheable";
          value = cacheable;
        };
    in
    {
      packages = lib.genAttrs [ "x86_64-linux" "aarch64-darwin" ] packages;
      checks.${system} = lib.genAttrs [ "pl" "en" ] check;
    };
}
