"""Business-logic layer.

Services orchestrate the domain: they depend on repository *interfaces* and the
``core`` helpers, never on FastAPI or SQLAlchemy sessions directly. They raise
``AppError`` subclasses instead of HTTP errors so they stay transport-agnostic.
"""
