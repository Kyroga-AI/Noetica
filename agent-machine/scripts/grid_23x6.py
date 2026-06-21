#!/usr/bin/env python3
"""
grid_23x6 — Task 2 of the Intent Algebra handoff: grid the 23 × 6 matrix.

Rows = the reconciled canonical-22 domain topics (derived latently from the MIT-OCW corpus
via LSA/LSI/LDA — see reconcile_topics.py) + the +1 meta-row (the containing matter).
Columns = the 6 verified actions (intent_algebra.py: 3 substrates × 2 polarities).

Validity carries the chomer/tzurah spine (intent_algebra_spine.md): store + held actions
apply to every domain (all matter can be stored/held/formed), but the WORLD substrate only
applies to domains with a PHYSICAL referent — purely formal matter has no world to sense or
act on. Empty cells are information, not gaps.

Run:  python3 scripts/grid_23x6.py          # markdown grid
      python3 scripts/grid_23x6.py --csv     # CSV
      python3 scripts/grid_23x6.py --json     # cell records
"""
import sys, json, csv, io

# canonical-22 rows: (name, has_physical_world_referent, derivation evidence terms)
ROWS = [
    ('pure_mathematics',           False, 'theorem proof lemma compact'),
    ('abstract_algebra',           False, 'group ring field algebraic'),
    ('linear_algebra',             False, 'matrix eigenvalue column diagonal'),
    ('differential_equations',     False, 'differential analysis numerical equations'),
    ('probability_statistics',     False, 'random variance gaussian estimation'),
    ('algorithms_data_structures', False, 'graph edges vertex list array'),
    ('optimization_game_theory',   False, 'player game risk optimization'),
    ('quantum_mechanics',          True,  'quantum electron spin hamiltonian'),
    ('classical_continuum_mech',   True,  'stress force velocity pressure'),
    ('electromagnetism_circuits',  True,  'voltage circuit field electric'),
    ('thermodynamics',             True,  'heat entropy cycle flow'),
    ('waves_optics',               True,  'wave light optical imaging'),
    ('nuclear_engineering',        True,  'reactor neutron fuel'),
    ('chemistry',                  True,  'reaction organic acid substrate'),
    ('molecular_cell_biology',     True,  'cell protein gene membrane'),
    ('earth_ocean_atmosphere',     True,  'earth ocean climate water'),
    ('cognitive_neuroscience',     True,  'brain memory cognitive behavior'),
    ('materials_experimental',     True,  'beam strain diameter measure'),
    ('aerospace_systems_eng',      True,  'vehicle flight performance requirements'),
    ('signal_processing_control',  True,  'signal loop transfer response'),
    ('computer_systems',           True,  'program memory device processor'),
    ('economics_management',       False, 'cost risk management resource'),
]
META = ('meta · embedding', None, 'identity / no-op · describe without transforming')

# 6 actions: (name, substrate, polarity, target_specialist)
COLS = [
    ('create',    'store', 'write', 'executor'),
    ('retrieve',  'store', 'read',  'researcher'),
    ('transform', 'held',  'write', 'planner'),
    ('evaluate',  'held',  'read',  'local'),
    ('execute',   'world', 'write', 'executor'),
    ('sense',     'world', 'read',  'local'),
]


def valid(row, col):
    name, world, _ = row
    sub = col[1]
    if name == 'meta · embedding':
        return col[0] == 'evaluate'        # identity/no-op = read held without transforming
    if sub == 'world':
        return bool(world)                  # world actions only where there's a physical referent
    return True                             # store + held actions apply to all matter


def cells():
    for r in ROWS + [META]:
        for c in COLS:
            yield {'topic': r[0], 'action': c[0], 'substrate': c[1], 'polarity': c[2],
                   'valid': valid(r, c), 'specialist': c[3] if valid(r, c) else None,
                   'fidelity_bar': 'TODO: machine-checkable constraint set'}


def main():
    if '--json' in sys.argv:
        print(json.dumps(list(cells()), indent=2)); return
    if '--csv' in sys.argv:
        w = csv.writer(sys.stdout)
        w.writerow(['topic'] + [c[0] for c in COLS])
        for r in ROWS + [META]:
            w.writerow([r[0]] + ['Y' if valid(r, c) else '' for c in COLS])
        return
    # markdown grid
    hdr = '| topic | ' + ' | '.join(c[0] for c in COLS) + ' |'
    print('# Intent Algebra · 23 × 6 grid  (✓ valid · · empty=information)\n')
    print('  columns: ' + ' · '.join(f'{c[0]}({c[1]}/{c[2][0]})' for c in COLS) + '\n')
    print(hdr); print('|' + '---|' * (len(COLS) + 1))
    nvalid = 0
    for r in ROWS + [META]:
        marks = []
        for c in COLS:
            ok = valid(r, c); nvalid += ok
            marks.append('✓' if ok else '·')
        print(f'| {r[0]} | ' + ' | '.join(marks) + ' |')
    total = (len(ROWS) + 1) * len(COLS)
    print(f'\n  {len(ROWS)}+1 rows × {len(COLS)} cols = {total} cells · {nvalid} valid · {total-nvalid} empty (information)')
    print('  specialists: create→executor · retrieve→researcher · transform→planner · evaluate→local · execute→executor · sense→local')
    print('  empties: world actions (execute/sense) are blank for purely formal domains — no physical referent to act on or perceive.')


if __name__ == '__main__':
    main()
