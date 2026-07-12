# Future visit contract

Invitation states: `pending`, `accepted`, `rejected`, `cancelled`, `expired`. Session states: `preparing`, `travelling`, `arrived`, `active`, `returning`, `completed`, `failed`. No visit workflow is implemented in S1. Future owner-offline handling uses a 45-second grace period and terminates with `owner_offline` if the owner does not reconnect.
