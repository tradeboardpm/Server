# Server
# rules logic

master date will only change if:
    1.journal is created for that date (here journal menas trades, rules follwed, journal(notes,mistake,lessons)).
    2.if date with journal id bigger that current master date means if master dates is now 14th june but when i make journal on 16th june it becomes master date as its bigger than 14 and has journal.

when user goes to a date with no rules journal or trades show master dates rules but not load in that dates db until journal is creted or user edits/ deletes/ adds rules
means if users master date is 16th june he goes on 11th june where there is no journal created all rules of master date will be visible and if user adds rules or edits or relete from list these new rules will be for 1th june no chnage to master date and master dates rules

when first time login user will have no rules and should also not have master date (currently its taking current date) master date will be the date where user loaded standard rules or added rules first time and then master date chnages when user goes to bigger date d a journal is created or rules modifed or added or deleted
