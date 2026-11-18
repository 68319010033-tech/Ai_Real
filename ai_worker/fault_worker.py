"""Synthetic fault-injection app; never used by the production main:app entry point."""
import time
import main


def hold(payload, sender, limit):
    time.sleep(30)


main.manager.target = hold
app = main.app


@app.get('/test-child-pid')
async def owned_child():
    return {'pid': main.manager.process.pid if main.manager.process else None}
