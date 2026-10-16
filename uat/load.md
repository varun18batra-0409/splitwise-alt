# Load test


Crashed: PrismaClientKnownRequestError: 
Invalid `db.account.createMany()` invocation in
/home/runner/work/splitwise-alt/splitwise-alt/scripts/load.ts:33:20

  30 const stamp = Date.now();
  31 const accounts = [];
  32 for (let i = 0; i < 400; i++) accounts.push({ id: `la${stamp}${i}`, email: `load${i}-${stamp}@load.test`, name: `Person ${i}` });
→ 33 await db.account.createMany(
Raw query failed. Code: `InvalidArg`. Message: `unknown variant `SocketTimeout`, expected one of `GenericJs`, `UnsupportedNativeDataType`, `InvalidIsolationLevel`, `LengthMismatch`, `UniqueConstraintViolation`, `NullConstraintViolation`, `ForeignKeyConstraintViolation`, `DatabaseNotReachable`, `DatabaseDoesNotExist`, `DatabaseAlreadyExists`, `DatabaseAccessDenied`, `ConnectionClosed`, `TlsConnectionError`, `AuthenticationFailed`, `TransactionWriteConflict`, `TableDoesNotExist`, `ColumnNotFound`, `TooManyConnections`, `ValueOutOfRange`, `MissingFullTextSearchIndex`, `TransactionAlreadyClosed`, `postgres`, `mysql`, `sqlite`, `mssql``