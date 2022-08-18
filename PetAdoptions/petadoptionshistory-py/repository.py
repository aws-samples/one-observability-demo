def list_transaction_history(db):
    sql = 'SELECT * FROM transactions_history'

    cur = db.cursor()
    cur.execute(sql)
    result = cur.fetchall()

    return result

def delete_transaction_history(db):
    sql = 'DELETE FROM transactions_history'

    cur = db.cursor()
    result = cur.execute(sql)

    return result

def count_transaction_history(db):
    sql = 'SELECT count(*) FROM transactions_history'

    cur = db.cursor()
    cur.execute(sql)
    result = cur.fetchone()

    return result[0]