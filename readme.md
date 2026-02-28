

# 功能

1. 需要通过一个接口获取到数据列表，然后给一个按钮，点击的时候会点击另外的接口进行请求

2. 需要支持批量选择数据，然后统一操作，但是需要遍历调用接口，需要设置间隔时间来调用接口，防止被ip禁用，设置一个正常的操作时间间隔

3. 尽量可以更多的显示数据内容，比如一页可以显示几十条，排版优化下

4. 请求需要有cookie，所以需要给一个配置页，所以用来配置数据
包括cookie，
用户id，用于接口列表的 euid
接口列表的maxTime 也是动态计算的，根据几个列表接口的实际调用按钮来推算一下计算的规则

5. 支持同时配置多个 euid 来抓取不同用户的接口数据，而且最好可以平铺展示在首页中

6. 首页展示接口列表的数据，包括用户名，时间，内容

7. 支持抓取用户的主页信息，并且过滤出主要的内容，连接是https://my.hupu.com/21291079?tabKey=2，数字是用户id
抓取dom 的类名为 tagTitleList  的最后一个节点的内容
包括 回帖的数字，推荐的数字

8. 有一个页面，专门显示已经配置的用户信息，显示包括名称，用户id，用户的主页信息抓取的内容
并且已经配置过的用户信息需要保存成json 在本地

9. 所有操作过的数据，记录id 和内容、userid、用户名，成json保存到本地


## 数据列表接口

fetch("https://my.hupu.com/pcmapi/pc/space/v1/getReplyList?euid=21291079&maxTime=1771748033&page=10&pageSize=10", {
  "headers": {
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin"
  },
  "referrer": "https://my.hupu.com/21291079?tabKey=2",
  "body": null,
  "method": "GET",
  "mode": "cors",
  "credentials": "include"
});
fetch("https://my.hupu.com/pcmapi/pc/space/v1/getReplyList?euid=21291079&maxTime=1771341023&page=4&pageSize=10", {
  "headers": {
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin"
  },
  "referrer": "https://my.hupu.com/21291079?tabKey=2",
  "body": null,
  "method": "GET",
  "mode": "cors",
  "credentials": "include"
});
fetch("https://my.hupu.com/pcmapi/pc/space/v1/getReplyList?euid=21291079&maxTime=1770981396&page=6&pageSize=10", {
  "headers": {
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin"
  },
  "referrer": "https://my.hupu.com/21291079?tabKey=2",
  "body": null,
  "method": "GET",
  "mode": "cors",
  "credentials": "include"
});

## 数据列表接口成功响应
{
  "code": 1,
  "internalCode": "PC000000",
  "msg": "success",
  "data": {
    "replyWithQuoteDtoList": [
      {
        "pid": 277439,
        "tid": 637532619,
        "aid": null,
        "puid": 21291079,
        "euid": null,
        "username": "大黄10086",
        "header": "https://i1.hoopchina.com.cn/user/109/246386995506109/246386995506109-1589156324.jpeg",
        "userIp": "39.144.98.213",
        "via": 9,
        "content": "一个七十五大十七胜    四个七十五大三十三胜人均不到8.5    我詹不如科比一半啊   你是詹黑吗？",
        "quote": 268626,
        "quoteInfo": {
          "pid": 268626,
          "tid": 637532619,
          "aid": null,
          "puid": 108229318,
          "euid": 130773469635777,
          "username": "虎扑JR0100743664",
          "header": "https://i2.hoopchina.com.cn/user/default/light1.png",
          "userIp": "125.43.77.214",
          "via": 9,
          "content": "带队17胜？",
          "quote": 35474,
          "quoteInfo": null,
          "createTime": 1771472835,
          "updateInfo": "0",
          "attr": "a:2:{s:6:\"source\";s:3:\"app\";s:12:\"audit_status\";i:1;}",
          "score": 7310,
          "videoInfo": null,
          "lightCount": 24,
          "unlightCount": 0,
          "replyReplyNum": null,
          "picInfos": [],
          "title": "主帖已被删除",
          "formatTime": "02-19",
          "nextRowKey": null,
          "topicId": 286,
          "topicName": null,
          "nftInfo": null
        },
        "createTime": 1771480860,
        "updateInfo": "0",
        "attr": "a:2:{s:6:\"source\";s:3:\"app\";s:12:\"audit_status\";i:1;}",
        "score": 5389,
        "videoInfo": null,
        "lightCount": 4,
        "unlightCount": 0,
        "replyReplyNum": null,
        "picInfos": [],
        "title": "主帖已被删除",
        "formatTime": "02-19",
        "nextRowKey": null,
        "topicId": 286,
        "topicName": "回收站",
        "nftInfo": null
      }
      }
    ],
    "nextPage": true,
    "maxTime": 1771456579
  }
}



## 按钮点击接口
fetch("https://bbs.hupu.com/api/v2/threads/637534289/report", {
  "headers": {
    "accept": "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    "content-type": "application/json",
    "pragma": "no-cache",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin"
  },
  "referrer": "https://bbs.hupu.com/637534289-13.html",
  "body": "{\"tid\":\"637534289\",\"topicId\":\"179\",\"type\":\"4\",\"pid\":\"258711\",\"content\":\"低俗谩骂、阴阳怪气、攻击引战、跨区嘲讽\"}",
  "method": "POST",
  "mode": "cors",
  "credentials": "include"
});

## 按钮点击接口成功响应
{
  "code": 200,
  "message": "成功",
  "data": {}
}