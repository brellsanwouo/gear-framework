# Seeded fault model

`catalog.yml` is the complete mutation set for RQ3. Each operator changes one
valid project in memory and declares the diagnostic fragment expected from the
validator. The raw benchmark output preserves all actual diagnostics.

The reported detection rate applies only to these operators. It must not be
described as general validator precision or recall because the mutation catalog
is neither a random sample of all invalid projects nor a complete fault space.

