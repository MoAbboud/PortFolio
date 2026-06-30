"""ORM models.

Importing this package imports every model so that ``Base.metadata`` is complete
(needed by Alembic autogenerate and by ``create_all`` in tests) and relationship
string references resolve.
"""

from app.models.adventure import Adventure
from app.models.adventure_stats import AdventureStats
from app.models.comment import Comment
from app.models.like import Like
from app.models.log_entry import LogEntry
from app.models.rating import Rating
from app.models.stop import Stop
from app.models.user import User
from app.models.user_info import UserInfo
from app.models.weather import Weather

__all__ = [
    "Adventure",
    "AdventureStats",
    "Comment",
    "Like",
    "LogEntry",
    "Rating",
    "Stop",
    "User",
    "UserInfo",
    "Weather",
]
