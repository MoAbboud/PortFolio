"""Constants that two places must agree on.

EMBED_DIM is here rather than in settings because the migration and the SQLAlchemy model
have to use the same number, and a value that could be changed by an environment variable
would let them drift silently: the column would be one width and the code another.

Changing it is a migration that invalidates every vector already stored. That is the
honest place for the decision to live.
"""

EMBED_DIM = 384
