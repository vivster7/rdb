from goet.tracer.sql import SqlTracer
from goet.lib.db.sqlite import connection


class A:
    def __init__(self, x):
        self.x = x

    def __repr__(self) -> str:
        return f"A(x={getattr(self, 'x', None)})"


def fn():
    a = A(1)
    # fn2()
    a = 1 + 1
    b = a + 1
    return b


def fn2():
    a = 3
    return a


with SqlTracer(connection) as t:
    fn()
