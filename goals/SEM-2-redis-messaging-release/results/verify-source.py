import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[3]
BASE = "3ec254e25a56daab0e2546f75cd38804df40f44c"
FEATURE = "5b565ac9bef4ff569ac0e21726947fec279323e6"


def historical(ref, path):
    return subprocess.check_output(["git", "show", f"{ref}:{path}"], cwd=ROOT)


for name in ("core", "redis", "messaging", "otel"):
    path = f"packages/{name}/package.json"
    actual = json.loads((ROOT / path).read_text())
    expected = json.loads(historical(FEATURE, path))["exports"]
    expected.pop("./http-policy", None)
    assert actual["exports"] == expected, name
    assert actual["version"] == "0.3.0", name
    assert all(v == "0.3.0" for k, v in actual.get("peerDependencies", {}).items()
               if k.startswith("@semaphile/")), name
    lock_path = f"packages/{name}/package-lock.json"
    before = json.loads(historical(BASE, lock_path))
    after = json.loads((ROOT / lock_path).read_text())
    def identities(lock):
        return {k: {field: v.get(field) for field in ("version", "resolved", "integrity")}
                for k, v in lock["packages"].items()
                if k.startswith("node_modules/") and not k.startswith("node_modules/@semaphile/")}
    assert identities(before) == identities(after), name
    assert "@semaphile/proxy" not in json.dumps(after), name
    print(f"PASS {name}: version/peers, export parity, third-party identities, no proxy lock")
section = b"## 20. Redis messaging"
actual = (ROOT / "SPEC.md").read_bytes().split(section, 1)[1]
expected = historical(FEATURE, "SPEC.md").split(section, 1)[1]
assert actual == expected
assert not (ROOT / "packages/proxy").exists()
assert not (ROOT / "conformance/proxy").exists()
for path in ("packages/messaging/src/cli.ts", "conformance/run.mjs"):
    assert "proxy" not in (ROOT / path).read_text()
print("PASS SPEC section 20 byte parity, excluded proxy directories and command/runner routes")
print("RESULT 5/5 passed")
