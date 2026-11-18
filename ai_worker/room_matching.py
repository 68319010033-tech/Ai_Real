"""Exact Hall-capacity model and deterministic augmenting-path room assignment."""


def room_unions(domains, cap=128):
    unions = {frozenset()}
    for domain in sorted(set(map(frozenset, domains)), key=lambda d: (len(d), sorted(d))):
        unions |= {u | domain for u in list(unions)}
        if len(unions) > cap:
            return None  # Use the original integer room model for complex domains.
    return sorted(unions, key=lambda d: (len(d), sorted(d)))


def match_rooms(events):
    """events maps hashable event IDs to allowed room numbers; None if infeasible."""
    owner = {}
    def augment(event, seen):
        for room in sorted(events[event]):
            if room in seen:
                continue
            seen.add(room)
            if room not in owner or augment(owner[room], seen):
                owner[room] = event
                return True
        return False
    for event in sorted(events, key=lambda e: (len(events[e]), repr(e))):
        if not augment(event, set()):
            return None
    return {event: room for room, event in owner.items()}
