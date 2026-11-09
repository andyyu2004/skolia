# The tools the justfile needs beyond pnpm and uv: terraform and just, and for just dev,
# sops and age, and git-lfs for the reader's screenshots. nix develop puts them on PATH; CI adds only packages.tools to PATH
# (.github/actions/setup).
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      # HashiCorp's release: nixpkgs builds terraform from source, as it's unfree (BUSL),
      # which takes minutes in each CI job
      terraformVersion = "1.17.1";
      terraformZips = {
        x86_64-linux = {
          platform = "linux_amd64";
          hash = "sha256-RjhigFjnGlUhKxxWNxLqwDuQISj0B0Dz3IF03xITUGE=";
        };
        aarch64-linux = {
          platform = "linux_arm64";
          hash = "sha256-mI6VChwjBYCTsOZqstX7U/wYNF7PvVhxrPUduskyXt0=";
        };
        aarch64-darwin = {
          platform = "darwin_arm64";
          hash = "sha256-seyz/g0KApDBq2+D2WfUPyXaBdC2ce4Ps1UlImjc6Vo=";
        };
      };

      perSystem =
        system: zip:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          terraform = pkgs.stdenvNoCC.mkDerivation {
            pname = "terraform";
            version = terraformVersion;
            src = pkgs.fetchurl {
              url = "https://releases.hashicorp.com/terraform/${terraformVersion}/terraform_${terraformVersion}_${zip.platform}.zip";
              inherit (zip) hash;
            };
            nativeBuildInputs = [ pkgs.unzip ];
            sourceRoot = ".";
            dontStrip = true;
            installPhase = "install -Dm755 terraform $out/bin/terraform";
          };
          tools = pkgs.buildEnv {
            name = "skolia-tools";
            paths = [
              terraform
              pkgs.just
            ];
          };
        in
        {
          packages.tools = tools;
          devShells.default = pkgs.mkShellNoCC {
            packages = [
              tools
              pkgs.sops
              pkgs.age
              pkgs.git-lfs
            ];
          };
        };
      systems = builtins.mapAttrs perSystem terraformZips;
    in
    {
      packages = builtins.mapAttrs (_: s: s.packages) systems;
      devShells = builtins.mapAttrs (_: s: s.devShells) systems;
    };
}
