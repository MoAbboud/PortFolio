"""ORM models.

Importing this package imports every model so that ``Base.metadata`` is complete
(needed by Alembic autogenerate and by ``create_all`` in tests) and relationship
string references resolve.
"""

from app.models.day import Day
from app.models.stop import Stop
from app.models.user import User

__all__ = ["Day", "Stop", "User"]
