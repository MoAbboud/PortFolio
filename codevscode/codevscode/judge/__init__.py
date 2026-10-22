"""The judge: a queue of jobs in PostgreSQL, a worker that claims them, and a sandbox that runs
each one in a throwaway container."""
