"""Productivity is the core rule: every licensed prefix chain attaches to
ANY root. 'mere' (Sw. -maliza, finish) is a speaker-confirmed root that the
data only attests in the infinitive (kumerea); every rule-licensed form of it
must validate, with the same morphemes it was generated from."""
from kitaita_oracle import get_oracle, analyse

ROOT = "mere"


def test_root_is_known_and_only_attested_in_infinitive():
    o = get_oracle()
    assert ROOT in o.verbs["dav"].roots
    assert not o.verbs["dav"].roots[ROOT].get("unverified")


def test_every_licensed_form_validates():
    forms = get_oracle().verbs["dav"].generate(ROOT)
    assert len(forms) > 200
    failures = []
    for f in forms:
        parses = [p for p in analyse(f["surface"])["parses"] if p["word_type"] == "verb"]
        if not any(p["paradigm"] == f["paradigm"] and p["slots"][-2]["form"] == ROOT for p in parses):
            failures.append(f["surface"])
    assert failures == []


def test_generation_does_not_depend_on_attested_forms():
    # the same chains attach to a different verified root with no inflected attestation
    o = get_oracle().verbs["dav"]
    a = {(g["paradigm"], tuple(g["morphemes"]), g["fv"]) for g in o.generate("mere")}
    b = {(g["paradigm"], tuple(g["morphemes"]), g["fv"]) for g in o.generate("sek")}
    assert a == b
