from goet.tracer.sql import SqlTracer
from goet.lib.db.sqlite import connection
from helpers import add


class A:
    def __init__(self, x):
        self.x = x

    def __repr__(self) -> str:
        return f"A(x={getattr(self, 'x', None)})"


def fn():
    A(1)
    a = add(1, 2)
    b = 1 + 1
    c = a + b
    # comment
    return c


def fn2():
    a = 3
    return a


with SqlTracer(connection) as t:
    fn()
