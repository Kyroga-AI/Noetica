from __future__ import annotations

from lark import Lark, Transformer, v_args

# Safe Cypher subset tailored for CSKG expansion patterns.
#
# Examples supported:
#   MATCH (h:Concept {form:$lemma})-[:CSKG*1..2]->(t) RETURN t.form LIMIT 25
#   MATCH p=(h:Concept {form:"rain"})-[:CSKG*1..2 {relation:"IsA"}]->(t) RETURN nodes(p), relationships(p) LIMIT 10
#
# Note: We avoid naming any rule "return" because it's a Python keyword and can
# trip up transformer dispatch.

GRAMMAR = r"""
?start: query

?query: match ret limit?

match: "MATCH"i pattern

pattern: pathvar? node rel_chain
pathvar: CNAME "="

node: "(" var? label? props? ")"
var: CNAME
label: ":" CNAME
props: "{" [prop ("," prop)*] "}"
prop: CNAME ":" value

rel_chain: (rel node)+
rel: "-[" reltype range? props? "]->"
reltype: ":" CNAME
range: "*" INT ".." INT

ret: "RETURN"i ret_items
ret_items: ret_item ("," ret_item)*
ret_item: CNAME "." CNAME                 -> prop_access
        | "nodes" "(" CNAME ")"           -> nodes_func
        | "relationships" "(" CNAME ")"   -> rels_func

limit: "LIMIT"i INT

value: ESCAPED_STRING     -> string
     | PARAM              -> param
     | CNAME              -> ident

PARAM: /\$[a-zA-Z_][a-zA-Z0-9_]*/

%import common.CNAME
%import common.ESCAPED_STRING
%import common.INT
%import common.WS
%ignore WS
"""

_parser = Lark(GRAMMAR, start="start", maybe_placeholders=False)

@v_args(inline=True)
class _Tx(Transformer):
    def string(self, v):
        return v.value[1:-1]

    def param(self, v):
        return ("param", v.value[1:])  # strip leading $

    def ident(self, v):
        return ("ident", v.value)

    def prop(self, k, v):
        return (str(k), v)

    def props(self, *items):
        return dict(items)

    def var(self, name):
        return ("var", str(name))

    def label(self, name):
        return ("label", str(name))

    def reltype(self, name):
        return str(name)

    def range(self, a, b):
        return (int(a), int(b))

    def pathvar(self, name):
        return str(name)

    def node(self, *parts):
        var = None
        label = None
        props = {}
        for p in parts:
            if isinstance(p, tuple) and len(p) == 2:
                if p[0] == "var":
                    var = p[1]
                elif p[0] == "label":
                    label = p[1]
            elif isinstance(p, dict):
                props = p
        return {"var": var, "label": label, "props": props}

    def rel(self, *parts):
        rtype = None
        rng = None
        props = {}
        for p in parts:
            if isinstance(p, str):
                rtype = p
            elif isinstance(p, tuple) and len(p) == 2 and all(isinstance(x, int) for x in p):
                rng = p
            elif isinstance(p, dict):
                props = p
        return {"type": rtype, "range": rng, "props": props}

    def rel_chain(self, *items):
        return list(items)  # [rel, node, rel, node, ...]

    def pattern(self, *parts):
        if len(parts) == 3:
            pv, head, chain = parts
        else:
            pv, head, chain = None, parts[0], parts[1]
        return {"path_var": pv, "head": head, "chain": chain}

    def match(self, pat):
        return {"match": pat}

    def prop_access(self, var, prop):
        return {"type": "prop", "var": str(var), "prop": str(prop), "expr": f"{var}.{prop}"}

    def nodes_func(self, var):
        return {"type": "nodes", "var": str(var), "expr": f"nodes({var})"}

    def rels_func(self, var):
        return {"type": "rels", "var": str(var), "expr": f"relationships({var})"}

    def ret_items(self, *items):
        return list(items)

    def ret(self, items):
        return {"return": items}

    def limit(self, n):
        return {"limit": int(n)}

    def query(self, match, ret, lim=None):
        q = {}
        q.update(match)
        q.update(ret)
        if lim is not None:
            q.update(lim)
        return q

def parse_cypher(query: str):
    tree = _parser.parse(query)
    return _Tx().transform(tree)
