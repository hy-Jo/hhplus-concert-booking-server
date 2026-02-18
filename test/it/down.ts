import { getDatasource } from "./util";

const down = async () => {
  await (await getDatasource()).destroy();
  await global.mysql.stop();
  await global.redis.stop();
};

export default down;
