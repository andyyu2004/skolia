import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT.parent / "shared" / "schema.gen.ts"


def test_typescript_types_are_up_to_date() -> None:
    spec = importlib.util.spec_from_file_location(
        "gen_ts_types", ROOT / "scripts" / "gen_ts_types.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    expected: str = module.generate()
    assert GENERATED.read_text(encoding="utf-8") == expected, (
        "shared/schema.gen.ts is stale: run "
        "uv run python scripts/gen_ts_types.py > ../shared/schema.gen.ts"
    )
