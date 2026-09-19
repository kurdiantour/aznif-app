Shop currency correction before Remote/Push

Canonical Shop currency: Gem.
Changed active Shop contract from price_gold to price_gem.
Purchase RPC debits wallets.gem and writes wallet_transactions.currency='Gem'.
Pending migration renames legacy shop_items.price_gold to price_gem in-place when appropriate.
Shop default provisioning now has its own trigger and no longer replaces handle_new_user_wallets().
No Remote/Push/Deploy performed.
