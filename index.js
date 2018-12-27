const puppeteer = require("puppeteer");
const pageParser = require("./lib/pageParser");
const articleParser = require("./lib/articleParser");
const Sequelize = require("sequelize");

const sequelize = new Sequelize(
  "heroku_6b3036d88f374e5",
  "b533748927bff2",
  "aad075c1",
  {
    host: "us-cdbr-iron-east-01.cleardb.net",
    dialect: "mysql",

    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },

    // http://docs.sequelizejs.com/manual/tutorial/querying.html#operators
    operatorsAliases: false
  }
);

const Post = sequelize.define(
  "post",
  {
    id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    title: Sequelize.STRING(100),
    gameName: Sequelize.STRING(50),
    price: Sequelize.BIGINT,
    postAt: Sequelize.BIGINT,
    link: Sequelize.STRING(100),
    gameID: Sequelize.INTEGER
  },
  {
    timestamps: true
  }
);

const Game = sequelize.define(
  "game",
  {
    id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: Sequelize.STRING(30),
    lowest_price: Sequelize.INTEGER(5),
    lp_link: Sequelize.STRING(100),
    post_count: Sequelize.INTEGER(3)
  },
  {
    timestamps: true,
    createdAt: false, 
    updatedAt: 'updatedAt',
  }
);

const GameName = sequelize.define(
  "game_name_alias",
  {
    id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: Sequelize.STRING(30),
    gameID: Sequelize.INTEGER
  },
  {
    timestamps: false
  }
);

sequelize
  .authenticate()
  .then(() => {
    console.log("Connection has been established successfully.");
  })
  .catch(err => {
    console.error("Unable to connect to the database:", err);
  });

//mysql://b533748927bff2:aad075c1@us-cdbr-iron-east-01.cleardb.net/heroku_6b3036d88f374e5?reconnect=true
// const connection = mysql.createConnection({
//   host: "us-cdbr-iron-east-01.cleardb.net",
//   user: "b533748927bff2",
//   password: "aad075c1",
//   database: "heroku_6b3036d88f374e5"
// });

const board = "Gamesale";

const findGameID = (games, name) => {
  if (
    name.includes("特典") &&
    !name.includes("含") &&
    !name.includes("無特典") &&
    !name.includes("付特典")
  )
    return null;
  for (index in games) {
    if (name.toLowerCase().includes(games[index].name.toLowerCase())) {
      return games[index].gameID;
    }
  }
  console.log(`no name found: ${name}`);
  return null;
};

const crawler = async () => {
  let nowPage = 0;
  console.log("----------STARTING----------");
  const games = await GameName.findAll().map(data => data.dataValues);
  console.log(games);
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"]
  });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (
      ["image", "stylesheet", "font", "script"].indexOf(
        request.resourceType()
      ) !== -1
    ) {
      request.abort();
    } else {
      request.continue();
    }
  });

  let pageInfo;
  let stop = false;

  const latestPost = (await Post.max("postAt")) - 28800000 || 0;
  console.log(`latestPost: ${new Date(latestPost)}--${latestPost}`);
  while (!stop) {
    console.log(`nowPage: ${nowPage}`);
    let p = await page.goto(
      `https://www.ptt.cc/bbs/${board}/index${nowPage}.html`,
      {
        waitUntil: "domcontentloaded",
        timeout: 0
      }
    );

    if ((await p.status()) >= 400) {
      console.log("此頁不存在");
      continue;
    }

    pageInfo = await page.evaluate(pageParser);
    nowPage = pageInfo.pageNumber; //Now page;
    let articleInfo = [];

    for (let i = pageInfo.links.length - 1; i >= 0; i--) {
      let article = await page.goto(pageInfo.links[i].link, {
        waitUntil: "domcontentloaded",
        timeout: 0
      });
      if ((await article.status()) >= 400) {
        console.log("此篇文章不存在");
        continue;
      }
      const parsedArticle = await page.evaluate(articleParser);

      if (
        parsedArticle.postInfo.title.includes("宣導") ||
        parsedArticle.postInfo.title.includes("公告") ||
        parsedArticle.postInfo.time === undefined ||
        parsedArticle.contentInfo.price === null
      ) {
        console.log("宣導公告 / no time / no price ");
        continue;
      }
      const postTime = new Date(`${parsedArticle.postInfo.time} GMT+08:00`);
      console.log(`postTime: ${postTime}--${postTime.getTime()}`);
      if (postTime.getTime() <= latestPost) {
        stop = true;
        break;
      }
      const price = (parsedArticle.contentInfo.price = parseInt(
        parsedArticle.contentInfo.price
      ));
      if (
        parsedArticle.postInfo.title.includes("NS") &&
        !parsedArticle.postInfo.title.includes("徵") &&
        !parsedArticle.postInfo.title.includes("收") &&
        parsedArticle.postInfo.link !== "" &&
        price < 6000 &&
        price > 400
      ) {
        parsedArticle.gameName = parsedArticle.contentInfo.text
          .slice(parsedArticle.contentInfo.text.indexOf("物品名稱】：") + 6)
          .slice(
            0,
            parsedArticle.contentInfo.text
              .slice(parsedArticle.contentInfo.text.indexOf("物品名稱】：") + 6)
              .indexOf("\n")
          );
        parsedArticle.gameID = findGameID(games, parsedArticle.gameName);
        articleInfo.push(parsedArticle);
      }
    }
    const mappedArticleInfo = articleInfo.map(article => ({
      title: article.postInfo.title,
      gameName: article.gameName,
      price: article.contentInfo.price,
      postAt: new Date(article.postInfo.time).getTime(),
      link: article.postInfo.link,
      gameID: article.gameID
    }));

    Post.bulkCreate(mappedArticleInfo, { validate: true });
    mappedArticleInfo.forEach(async article => {
      let game = await Game.findByPk(article.gameID);
      let lowestPrice = await game.dataValues.lowest_price;
      if (lowestPrice === null || lowestPrice > article.price) {
        game.set({ lowest_price: article.price, lp_link: article.link });
      }
      game.set({ post_count: game.dataValues.post_count + 1 });
      game.save();
    });

    nowPage -= 1;
    if (nowPage === 3000) {
      break;
    }
  }
  await browser.close();
  console.log("----------complete----------");
  return false;
  // }
};
crawler();
setInterval(() => {
  crawler();
}, 300000);
