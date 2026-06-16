"""Top-level package for the Ba_Bazaar chat agent.

The package is built in slices; slice 1 ships the read-only analyze path so the
graph can be exercised end-to-end before booking writes are wired up.
"""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("ba-chat")
except PackageNotFoundError:  # editable install before metadata is generated
    __version__ = "0.1.0.dev0"
