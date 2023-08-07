import { MongoClient } from "mongodb";
import { Logger, ILogObj } from "tslog";

interface ITestData {
  _id: string;
  testList: string[];
}

const log: Logger<ILogObj> = new Logger();

const dbOperate = async (col: any, id: string, testId: string) => {
  const firstResult = await col.findOneAndUpdate(
    { _id: id, testList: { $not: { $eq: testId } } },
    {
      $push: {
        testList: {
          $each: [testId],
          $slice: 10,
        },
      },
    },
    {
      upsert: true,
      projection: { testList: 1 },
      returnDocument: "after",
    }
  );
};

const main = async (): Promise<void> => {
  const mongoClient = new MongoClient("mongodb://127.0.0.1:27017", {
    family: 4,
    noDelay: true,
    connectTimeoutMS: 5000,
  });

  await mongoClient.connect();

  const db = mongoClient.db("test");
  const col = db.collection<ITestData>("test_col");
  const id = "10001";
  const testId = "1001";

  // delete key may already exist
  await col.deleteOne({ _id: id });

  // should ok
  const firstResult = await dbOperate(col, id, testId);
  log.info("first result", firstResult);

  try {
    const secondResult = await dbOperate(col, id, testId); // trigger duplicate key error
    log.info("second result", secondResult);
  } catch (error) {
    console.log("error", error);
    log.error("second result", error); //traceback here
  }
};

main();
