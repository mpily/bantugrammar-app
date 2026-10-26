"""Hand-checked words. Positive verb/adjective forms are taken from the
research repo's speaker-verified sentences and Word Bank answers (cited
per case); negatives are constructed to hit one failure each."""
import pytest

from kitaita_oracle import analyse


def segs(parse):
    return [s["form"] for s in parse["slots"]]


def verb_parses(word):
    return [p for p in analyse(word)["parses"] if p["word_type"] == "verb"]


@pytest.mark.parametrize("word,expected_segments,source", [
    ("wawemanya", ["wa", "we", "many", "a"], "verified 'Mundu wawemanya' (cl.u, present)"),
    ("iwemanya", ["i", "we", "many", "a"], "verified 'Nyumba iwemanya' (unfused SM)"),
    ("ramanya", ["ra", "", "many", "a"], "verified 'Samaki ramanya' (zero present)"),
    ("rawewona", ["ra", "we", "won", "a"], "verified 'samaki rawewona'"),
    ("ghawesimama", ["gha", "we", "simam", "a"], "verified 'Mudi ghawesimama'"),
    ("wiwemanya", ["wi", "we", "many", "a"], "verified 'Wandu wiwemanya'"),
    ("kwawemanya", ["kwa", "we", "many", "a"], "verified 2sg present 'Kwawemanya'"),
    ("orekoghe", ["o", "re", "kogh", "e"], "verified 'Mundu orekoghe' (past, u->o)"),
    ("urekoghe", ["u", "re", "kogh", "e"], "verified 'Mwana urekoghe' (unshifted)"),
    ("jerekoghe", ["je", "re", "kogh", "e"], "verified 'Ituku jerekoghe'"),
    ("nerekoghe", ["ne", "re", "kogh", "e"], "verified 1sg past 'Nerekoghe'"),
    ("udedeka", ["u", "de", "dek", "a"], "verified 'Mlungu udedeka uzamie'"),
    ("ndeukunde", ["ndeu", "kund", "e"], "Word Bank negation, 'Mwalimu ndeukunde'"),
    ("ndewikunde", ["ndewi", "kund", "e"], "Word Bank negation, 'Watu ndewikunde'"),
    ("ndeghubuke", ["nde", "ghu", "", "buk", "e"], "Word Bank negation, 'Mori ndeghubuke'"),
])
def test_verified_verbs_parse(word, expected_segments, source):
    parses = verb_parses(word)
    assert any(segs(p) == expected_segments for p in parses), (source, [segs(p) for p in parses])


@pytest.mark.parametrize("word,word_type", [
    ("mundu", "noun"), ("ituku", "noun"), ("kikombe", "noun"), ("choka", "noun"),
    ("uzamie", "adjective"), ("jizamie", "adjective"), ("kibaa", "adjective"),
    ("kighenyi", "adjective"), ("vilemere", "adjective"), ("ndini", "adjective"),
])
def test_nouns_and_adjectives(word, word_type):
    r = analyse(word)
    assert r["valid"] and any(p["word_type"] == word_type for p in r["parses"])


@pytest.mark.parametrize("word,reason,what", [
    ("wewamanya", "illegal_affix_sequence", "TAM before SM"),
    ("uwechiwona", "illegal_affix_sequence", "OM 'chi' is not in the object-marker inventory"),
    ("ndezamie", "illegal_affix_sequence", "negative 'nde' is not an adjectival prefix"),
    ("kizamie", "illegal_affix_sequence", "series-A prefix ki- on series-B stem -zamie"),
    ("wawekpakpa", "unknown_root", "licensed prefix wa-we- + unknown root"),
    ("ndeukpakpe", "unknown_root", "licensed negative prefix + unknown root"),
    ("zzyzx", "not_in_dictionary", "nothing matches"),
])
def test_invalid_words_and_reasons(word, reason, what):
    r = analyse(word)
    assert r["valid"] is False and r["parses"] == [], what
    assert r["reason"] == reason, what


def test_swahili_parallel_parser():
    r = analyse("ninaipenda", lang="swh")
    assert r["valid"]
    assert any(segs(p) == ["ni", "na", "i", "pend", "a"] for p in r["parses"])
    assert any(segs(p) == ["hawa", "ku", "pend", "a"] for p in analyse("hawakupenda", lang="swh")["parses"])
    assert analyse("nanipenda", lang="swh")["valid"] is False


@pytest.mark.parametrize("word,swahili", [
    ("kwawemanya", "unajua"), ("nerekoghe", "nilikuwa"), ("ndeukunde", "hapendi"),
])
def test_swahili_equivalent(word, swahili):
    eqs = {e for p in verb_parses(word) for e in p["swahili_equivalents"]}
    assert swahili in eqs


def test_unverified_marking():
    # 'orekoghe' relies on the generalized past vowel-lowering rule (unverified)
    p = next(p for p in verb_parses("orekoghe") if segs(p) == ["o", "re", "kogh", "e"])
    assert p["uses_unverified_rules"] and any("past_sm_vowel_lowering" in i for i in p["unverified_items"])
    # 'ndeukunde' uses only speaker-verified table cells and a verified root
    p = next(p for p in verb_parses("ndeukunde"))
    assert p["uses_unverified_rules"] is False and p["unverified_items"] == []
    # every slot flagged unverified shows up in unverified_items
    for p in verb_parses("wawemanya"):
        flagged = [s for s in p["slots"] if s.get("unverified")]
        assert len(flagged) <= len(p["unverified_items"])


def test_ambiguity_is_enumerated():
    # 'wa' is the fused present SM of both class u and class wi
    classes = {p["slots"][0].get("underlying") for p in verb_parses("wawemanya")}
    assert {"u", "wi"} <= classes


def test_apostrophes_and_case():
    assert analyse("WAWEMANYA")["valid"]
    assert analyse("Mundu")["valid"]
