#!/usr/bin/env python3
"""
concept_extract — ensemble CONCEPT extraction with NO LLM calls. Replaces the noisy n-gram step in
hippo_graph with proper NLP: NLTK noun-phrase chunking + WordNet lemmatization (canonicalize
variants → free synonymy/dedup), spaCy noun_chunks + NER, GLiNER zero-shot STEM-concept NER (you
NAME the types — the Hugging Face entity extractor that's a BERT encoder, not an LLM), and KeyBERT
keyphrase salience. Each extractor is optional; whatever's installed gets used (NLTK alone still
beats raw n-grams). All CPU, deterministic — technique, not horsepower.

Use:  from concept_extract import ConceptExtractor
      cx = ConceptExtractor(); concepts_per_chunk = cx.extract_batch(list_of_texts)
"""
import re

# STEM concept types for GLiNER's zero-shot schema — name what we want, no fixed label set
STEM_LABELS = [
    'scientific concept', 'method or technique', 'physical quantity', 'chemical or compound',
    'organism or species', 'biological structure', 'theorem law or principle', 'mathematical object',
    'unit of measurement', 'disease or condition', 'material', 'reaction or process',
]
STOP = set(('the a an of to in is are and or for with on at by as be it this that which from we you i if then '
            'than into over under not no all any each its their his her our these those such can may will would '
            'could should has have had do does did but also more most some many one two use used using given '
            'when where what who how why between among about above below example problem figure table value').split())


def _ok(phrase):
    p = phrase.strip().lower()
    p = re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 \-]', '', p))
    toks = [t for t in p.split() if t and t not in STOP]
    p = ' '.join(toks)
    return p if (len(p) > 3 and len(toks) <= 4 and not p.replace(' ', '').isdigit()) else None


class ConceptExtractor:
    def __init__(self, gliner=True, keybert=True, spacy=True, gliner_model='urchade/gliner_small-v2.1'):
        self.lemm = None; self.np_grammar = None; self.nlp = None; self.gliner = None; self.kb = None
        try:
            import nltk
            from nltk.stem import WordNetLemmatizer
            self.nltk = nltk; self.lemm = WordNetLemmatizer()
            self.np_grammar = nltk.RegexpParser('NP: {<JJ.*>*<NN.*>+}')   # adjectives + noun run
        except Exception as e:
            self.nltk = None; print(f"  [concept_extract] NLTK off: {e}")
        if spacy:
            try:
                import spacy as sp; self.nlp = sp.load('en_core_web_sm', disable=['lemmatizer'])
            except Exception as e:
                print(f"  [concept_extract] spaCy off: {e}")
        if gliner:
            try:
                from gliner import GLiNER; self.gliner = GLiNER.from_pretrained(gliner_model)
                try:
                    import torch
                    if torch.cuda.is_available(): self.gliner = self.gliner.to('cuda'); print("  [concept_extract] GLiNER on CUDA")
                except Exception:
                    pass
            except Exception as e:
                print(f"  [concept_extract] GLiNER off: {e}")
        if keybert:
            try:
                from keybert import KeyBERT; self.kb = KeyBERT()
            except Exception as e:
                print(f"  [concept_extract] KeyBERT off: {e}")
        print(f"  [concept_extract] active: " + ', '.join(n for n, o in
              [('nltk', self.lemm), ('spacy', self.nlp), ('gliner', self.gliner), ('keybert', self.kb)] if o) or 'NONE')

    def _canon(self, phrase):
        p = _ok(phrase)
        if not p:
            return None
        if self.lemm:                                  # lemmatize the head/last noun so variants merge
            toks = p.split()
            toks[-1] = self.lemm.lemmatize(toks[-1])
            p = ' '.join(toks)
        return p

    def _nltk_nps(self, text):
        if not self.nltk:
            return []
        try:
            out = []
            for sent in self.nltk.sent_tokenize(text)[:8]:
                tags = self.nltk.pos_tag(self.nltk.word_tokenize(sent))
                for st in self.np_grammar.parse(tags).subtrees(lambda t: t.label() == 'NP'):
                    out.append(' '.join(w for w, _ in st.leaves()))
            return out
        except Exception:
            return []

    def extract_batch(self, texts, gliner_threshold=0.4):
        n = len(texts)
        cand = [[] for _ in range(n)]
        # NLTK noun phrases (always-on baseline)
        for i, t in enumerate(texts):
            cand[i] += self._nltk_nps(t)
        # spaCy noun_chunks + entities (batched)
        if self.nlp:
            try:
                for i, doc in enumerate(self.nlp.pipe(texts, batch_size=64)):
                    cand[i] += [nc.text for nc in doc.noun_chunks] + [e.text for e in doc.ents]
            except Exception as e:
                print(f"  [concept_extract] spaCy pipe failed: {e}")
        # GLiNER zero-shot STEM NER (batched)
        if self.gliner:
            try:
                preds = self.gliner.batch_predict_entities(texts, STEM_LABELS, threshold=gliner_threshold)
                for i, ents in enumerate(preds):
                    cand[i] += [e['text'] for e in ents]
            except Exception as e:
                print(f"  [concept_extract] GLiNER batch failed: {e}")
        # KeyBERT keyphrases
        if self.kb:
            try:
                for i, t in enumerate(texts):
                    cand[i] += [kw for kw, _ in self.kb.extract_keywords(t, keyphrase_ngram_range=(1, 3), top_n=8, stop_words='english')]
            except Exception as e:
                print(f"  [concept_extract] KeyBERT failed: {e}")
        # canonicalize + dedup per chunk
        return [{c for c in (self._canon(p) for p in cs) if c} for cs in cand]


if __name__ == '__main__':
    cx = ConceptExtractor()
    demo = ["In natural selection, individuals better adapted to their environment tend to survive and "
            "produce more offspring, so advantageous heritable traits become more common over generations.",
            "The mitochondrion is the powerhouse of the cell, generating ATP through oxidative phosphorylation."]
    for t, cs in zip(demo, cx.extract_batch(demo)):
        print(f"\n  «{t[:60]}…»\n   → {sorted(cs)}")
