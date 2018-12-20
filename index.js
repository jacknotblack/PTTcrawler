// const fs = require("fs");
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
    createdAt: Sequelize.BIGINT,
    updatedAt: Sequelize.BIGINT,
    version: Sequelize.BIGINT
  },
  {
    timestamps: false
  }
);

// Post.sync({ force: true }).then(() => {
//   // Table created
//   console.log(1);
//   return false;
// });

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
let nowPage = 0;

const crawler = async () => {
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

  const latestPost = (await Post.max("postAt")) || 0;
  console.log(`latestPost: ${new Date(latestPost)}`);
  while (!stop) {
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
      if (new Date(parsedArticle.postInfo.time).getTime() < latestPost) {
        stop = true;
        break;
      }
      if (
        parsedArticle.postInfo.title.includes("NS") &&
        parsedArticle.postInfo.title.includes("售") &&
        parsedArticle.contentInfo.price !== null
      ) {
        articleInfo.push(parsedArticle);
      }
    }
    const mappedarticleInfo = articleInfo.map(article => ({
      title: article.postInfo.title,
      gameName: article.contentInfo.text
        .slice(article.contentInfo.text.indexOf("物品名稱】：") + 6)
        .slice(
          0,
          article.contentInfo.text
            .slice(article.contentInfo.text.indexOf("物品名稱】：") + 6)
            .indexOf("\n")
        ),
      price: parseInt(article.contentInfo.price),
      postAt: new Date(article.postInfo.time).getTime(),
      link: article.postInfo.link
    }));

    Post.bulkCreate(mappedarticleInfo, { validate: true });

    // if (!fs.existsSync("./data")) fs.mkdirSync("./data");
    //write data to json
    // if (!fs.existsSync(`./data/${board}`)) fs.mkdirSync(`./data/${board}`);

    // fs.writeFileSync(
    //   `./data/${board}/${board}_${nowPage}.json`,
    //   JSON.stringify(articleInfo),
    //   { flag: "w" }
    // );
    // console.log(`Saved as data/${board}/${board}_${nowPage}.json`);
    nowPage -= 1;
    if (nowPage === 4000) {
      break;
    }
  }
  await browser.close();
  console.log("---complete---");
  return false;
  // }
};
crawler();
setInterval(() => {
  crawler();
}, 600000);
