"""The worker: one process, one loop, a few small jobs.

    python -m roamer.worker

Every few seconds it sends the email that is due and deletes listings nobody verified. Stage 5
adds the check-ins. A broker earns its place when there are many jobs, or when retries must
survive restarts in ways a database row cannot record; neither is true here, and the outbox
row already remembers how many times a message was tried.

A job that fails is logged and the loop goes on. One bad cycle must not stop the next.
"""

from __future__ import annotations

import logging
import signal
import time

from roamer import listings, mail
from roamer.config import settings
from roamer.db import SessionLocal

log = logging.getLogger("roamer.worker")


def run_once(mailer: mail.Mailer) -> None:
    for name, job in (
        ("send email", lambda session: mail.send_due(session, mailer)),
        ("delete unverified", listings.delete_unverified),
    ):
        try:
            with SessionLocal() as session:
                result = job(session)
            if result:
                log.info("%s: %s", name, result)
        except Exception:
            log.exception("%s failed; trying again next cycle", name)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    running = True

    def stop(*_: object) -> None:
        nonlocal running
        running = False

    # docker compose stop sends SIGTERM. Finish the cycle in hand, then exit cleanly.
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    mailer = mail.SmtpMailer()
    log.info("worker started; every %.0fs", settings.worker_interval_seconds)
    while running:
        run_once(mailer)
        slept = 0.0
        while running and slept < settings.worker_interval_seconds:
            time.sleep(0.5)
            slept += 0.5
    log.info("worker stopped")


if __name__ == "__main__":
    main()
