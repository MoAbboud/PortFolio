"""Data-access layer.

Each repository is defined as a ``Protocol`` (the interface the services depend
on) plus a concrete SQLAlchemy implementation. Swapping the storage engine, or
faking it in a test, means providing another implementation — the services never
change. That is the Dependency Inversion Principle in practice.
"""
