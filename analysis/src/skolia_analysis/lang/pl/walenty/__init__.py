"""Walenty, IPI PAN's valency dictionary of Polish (CC BY-SA 4.0), as typed data.

http://zil.ipipan.waw.pl/Walenty. The plain-text release has one schema per line:

    szukać: pewny: _: : imperf: subj{np(str)} + obj{np(gen)} + {prepnp(w,loc)}

vocabulary.py   every closed set in the notation, as Literal types
model.py        the notation as tagged unions (one TypedDict per variant, "kind" tells
                which), shaped like Rust enums so a port would be mechanical
parse.py        a strict parser: anything it doesn't recognise is an error, not a guess
"""
