# Contribute to the Navplace Viewer

## ❤️ Thank You
Thank you for considering a contribution to this viewer!  The `main` branch is protected and you cannot push to it.  Please make a new branch, and when you are a finished open a pull request targeting the `main` branch.  The pull request will be reviewed and we will get back to you.

## Ready to Install It And Run It!

***RUN THE APP IN A WEB SERVER CONTAINER***

If you want to contribute, it is imortant you are able to deploy the code and run locally.  To do so, it is best you use some kind of web server such as a [Docker Container](https://docs.docker.com/get-started/) or [Tomcat Web Server](https://tomcat.apache.org/).  You can use any web server container you prefer.  

You want a web server because the viewer's main usage requires asking the internet for resources by their URI, like https://store.rerum.io/v1/id/11111.  Opening the viewer through your filesystem as opposed to a web server will cause errors when trying to pull in resources from the web.  Feel free to try.

Make sure Git is installed on your machine.  For download and installation instruction, [head to the Git guide](https://git-scm.com/downloads).  Note this can also be achieved by installing [GitHub for Desktop](https://desktop.github.com/).  

The following is a git shell example for installing the app on your local machine.

```
cd /web_container/
git clone https://github.com/CenterForDigitalHumanities/navplace-viewer.git navplace-viewer
```

That's all you need!  Now start up your web server.  If you used the example above access the viewer at http://localhost/navplace-viewer  

## 🎉 Ready to Start Contributing!

Awesome, way to make it this far!  Now, make a new branch through the GitHub Interface or through your shell.  Make sure you 'checkout' that branch.

```
cd /web_container/navplace-viewer
git checkout my_new_branch
```

Now you can make code changes and see them in real time.  When you are finished with the commits to your new branch, open a Pull Request that targets the `main` branch at [https://github.com/CenterForDigitalHumanities/navplace-viewer/tree/main/](https://github.com/CenterForDigitalHumanities/navplace-viewer/tree/main/).
