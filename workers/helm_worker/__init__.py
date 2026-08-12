"""HELM's agent runtime.

Durable, checkpointed LangGraph agents that pause for human approval and resume
from the exact checkpoint — in a different process if need be.

Workers hold no provider credential and open no database connection. Every
model call goes through the gateway in `api/`.
"""
