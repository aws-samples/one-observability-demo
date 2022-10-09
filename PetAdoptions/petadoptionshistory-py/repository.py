def list_transaction_history(db):
    sql = 'SELECT * FROM transactions_history'

    cur = db.cursor()
    cur.execute(sql)
    result = cur.fetchall()
    db.commit()

    return result

def delete_transaction_history(db):
    sql = 'DELETE FROM transactions_history'

    cur = db.cursor()
    result = cur.execute(sql)
    db.commit()

    return result

def count_transaction_history(db):
    sql = 'SELECT count(*) FROM transactions_history'

    cur = db.cursor()
    cur.execute(sql)
    result = cur.fetchone()
    db.commit()

    return result[0]